-- 푸시 알림.
--
-- 소울메이트가 먼저 말을 걸어오는 건 이 서비스에서 가장 강한 재방문 장치다.
-- 다만 잘못 만들면 그대로 스팸이 되고, 스팸이 되면 알림 권한을 영구히 잃는다
-- (한 번 차단하면 사용자가 브라우저 설정에서 직접 풀지 않는 한 되돌릴 수 없다).
-- 그래서 선정 조건을 DB 함수 안에 못박아둔다.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 브라우저가 발급하는 푸시 서비스 주소. 기기+브라우저마다 다르다.
  -- UNIQUE 인 이유: 같은 기기에서 다시 구독하면 새 행이 아니라 갱신이어야 한다.
  endpoint text not null unique,
  -- 페이로드 암호화 키. 이게 없으면 알림을 보낼 수 없다.
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  /**
   * 연속 실패 횟수.
   *
   * 푸시 서비스가 404/410 을 주면 그 구독은 죽은 것이라 바로 지운다.
   * 그 외 오류(일시적인 5xx 등)는 여기에 쌓아두고, 계속 실패하면 보내기를 그만둔다.
   * 죽은 주소로 매일 두드리면 푸시 서비스가 우리 서버를 제한할 수 있다.
   */
  failure_count int not null default 0 check (failure_count >= 0)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

/**
 * 발송 기록.
 *
 * (user_id, period_key) PK 가 하루 한 번의 최종 방어선이다.
 * Vercel cron 은 재시도될 수 있고, 수동으로 두 번 호출할 수도 있다.
 * 애플리케이션에서 "오늘 보냈나" 를 조회한 뒤 보내면 그 사이에 끼어들 수 있다.
 */
create table public.push_dispatches (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 'YYYY-MM-DD' (KST). 무료 쿼터와 출석이 쓰는 기준과 같다.
  period_key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, period_key)
);

alter table public.push_subscriptions enable row level security;
alter table public.push_dispatches enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_dispatches from anon, authenticated;

/**
 * 구독 저장.
 *
 * 같은 endpoint 로 다시 오면 갱신한다. 브라우저는 권한을 다시 요청하거나
 * 앱을 재설치할 때 같은 주소를 그대로 주기도 하고, 그때 키만 바뀌기도 한다.
 * 소유자가 바뀌는 경우(같은 기기를 다른 계정으로 쓰는 경우)도 여기서 넘어간다.
 */
create or replace function public.upsert_push_subscription(
  p_user uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
as $$
begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (p_user, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        -- 다시 구독했다는 건 살아 있다는 뜻이다. 실패 기록을 지운다.
        failure_count = 0;
end;
$$;

/**
 * 오늘 알림을 보낼 대상을 고르고, 고르는 순간 발송 기록을 남긴다.
 *
 * 조회와 기록을 한 문장에 묶는 이유: 나눠 두면 cron 이 재시도될 때
 * 같은 사람에게 두 번 간다. 알림이 두 번 오는 건 그 자체로 스팸이다.
 *
 * 선정 조건
 *  - 구독이 살아 있다 (실패가 쌓인 구독은 제외)
 *  - 소울메이트가 있다 (없으면 할 말이 없다)
 *  - 최근 p_idle_hours 시간 동안 대화가 없다 (대화 중인 사람을 찌르지 않는다)
 *  - 오늘 아직 보내지 않았다
 *
 * 오래 안 온 사람을 먼저 고른다. 상한(p_limit)에 걸려 밀리는 사람이 생길 때
 * 매일 같은 사람만 받는 걸 막는다.
 */
create or replace function public.claim_push_targets(
  p_limit int,
  p_idle_hours int,
  p_max_failures int
)
returns table (
  user_id uuid,
  soulmate_id uuid,
  soulmate_name text,
  tone public.relationship_tone,
  persona jsonb,
  display_name text,
  last_message_at timestamptz
)
language plpgsql
as $$
/*
  returns table 의 출력 이름(user_id 등)이 plpgsql 변수로 잡혀서, 질의 안의 같은 이름
  컬럼과 충돌한다. `on conflict (user_id, period_key)` 처럼 테이블 별칭을 붙일 수 없는
  자리가 있어서 수식만으로는 피할 수 없다. 충돌하면 컬럼을 택하도록 지시한다.
*/
#variable_conflict use_column
declare
  v_today text := ((now() at time zone 'Asia/Seoul')::date)::text;
begin
  if p_limit <= 0 or p_idle_hours < 0 or p_max_failures < 0 then
    raise exception 'invalid push dispatch config' using errcode = '22023';
  end if;

  return query
  with eligible as (
    select s.user_id,
           s.id as soulmate_id,
           s.name as soulmate_name,
           s.tone,
           s.persona,
           p.display_name,
           (select max(m.created_at)
              from public.messages m
              join public.conversations c on c.id = m.conversation_id
             where c.soulmate_id = s.id) as last_message_at
      from public.soulmates s
      join public.profiles p on p.id = s.user_id
     where exists (
             select 1 from public.push_subscriptions ps
              where ps.user_id = s.user_id
                and ps.failure_count <= p_max_failures
           )
       and not exists (
             select 1 from public.push_dispatches d
              where d.user_id = s.user_id and d.period_key = v_today
           )
  ),
  quiet as (
    select * from eligible e
     where e.last_message_at is null
        or e.last_message_at < now() - make_interval(hours => p_idle_hours)
     -- 오래 안 온 사람 먼저. NULL(한 번도 대화 안 함)이 가장 먼저 온다.
     order by e.last_message_at asc nulls first
     limit p_limit
  ),
  claimed as (
    insert into public.push_dispatches (user_id, period_key)
    select q.user_id, v_today from quiet q
    -- 동시 호출에서 한쪽만 이긴다. 진 쪽은 아무 행도 못 받아 아무것도 보내지 않는다.
    on conflict (user_id, period_key) do nothing
    returning push_dispatches.user_id
  )
  select q.user_id, q.soulmate_id, q.soulmate_name, q.tone, q.persona,
         q.display_name, q.last_message_at
    from quiet q
    join claimed c on c.user_id = q.user_id;
end;
$$;

/**
 * 발송 결과 반영.
 *
 * 죽은 구독(404/410)은 바로 지운다. 그 외 실패는 세어두고, 성공하면 0 으로 되돌린다.
 */
create or replace function public.record_push_result(
  p_endpoint text,
  p_gone boolean,
  p_success boolean
)
returns void
language plpgsql
as $$
begin
  if p_gone then
    delete from public.push_subscriptions where endpoint = p_endpoint;
    return;
  end if;

  if p_success then
    update public.push_subscriptions
       set last_success_at = now(), failure_count = 0
     where endpoint = p_endpoint;
  else
    update public.push_subscriptions
       set failure_count = failure_count + 1
     where endpoint = p_endpoint;
  end if;
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
