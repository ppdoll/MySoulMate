-- 발송 대상 미리보기.
--
-- 문제: claim_push_targets 는 대상을 고르는 순간 "오늘 보냄" 을 기록한다.
-- 그게 두 번 보내는 걸 막는 장치인데, 테스트할 때는 한 번 호출하고 나면
-- 다음 날까지 아무것도 확인할 수 없다. 왜 0명인지 볼 방법도 없다.
--
-- 그래서 기록하지 않는 미리보기를 붙인다. 선정 조건을 복사해 두 함수로 나누지 않는다 --
-- 둘이 어긋나면 "미리보기에서는 나오는데 실제로는 안 가는" 상황이 되고,
-- 그건 디버깅 도구가 거짓말을 하는 것이라 없는 것보다 나쁘다.

-- 인자 개수가 다른 함수를 함께 두면 3개짜리 호출이 모호해진다. 먼저 지운다.
drop function if exists public.claim_push_targets(int, int, int);

create or replace function public.claim_push_targets(
  p_limit int,
  p_idle_hours int,
  p_max_failures int,
  /** true 면 아무것도 기록하지 않고 대상만 돌려준다. 테스트·진단용. */
  p_dry_run boolean default false
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
    -- 미리보기면 아무 행도 넣지 않는다. 조건 자체는 위에서 이미 한 번만 계산됐다.
    select q.user_id, v_today from quiet q where not p_dry_run
    -- 동시 호출에서 한쪽만 이긴다. 진 쪽은 아무 행도 못 받아 아무것도 보내지 않는다.
    on conflict (user_id, period_key) do nothing
    returning push_dispatches.user_id
  )
  select q.user_id, q.soulmate_id, q.soulmate_name, q.tone, q.persona,
         q.display_name, q.last_message_at
    from quiet q
   where p_dry_run
      or exists (select 1 from claimed c where c.user_id = q.user_id);
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
