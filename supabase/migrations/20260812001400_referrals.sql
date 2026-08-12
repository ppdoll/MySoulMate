-- 친구 초대.
--
-- 이 기능은 크레딧을 공짜로 만들어내는 경로라 어뷰징 방어가 본체다.
-- 구글 계정은 몇 분이면 만들 수 있어서, 막지 않으면 자기가 자기를 초대해
-- 무한히 찍어낼 수 있다. 방어는 네 겹이다.
--
--   1. referrals.invitee_id UNIQUE      -- 한 계정은 평생 한 번만 초대받는다
--   2. referrals_no_self CHECK          -- 자기 자신은 초대할 수 없다 (스키마에 이미 있음)
--   3. 초대받은 쪽이 실제로 대화해야 지급 -- 계정만 만들어놓는 건 소용없다
--   4. 초대자 상한 (하루 N명 / 누적 M명)  -- 속도와 총량을 함께 제한한다
--
-- 1,2는 DB 제약이라 코드가 틀려도 뚫리지 않는다. 3,4는 아래 함수가 지킨다.
--
-- 커스텀 SQLSTATE (기존 45001~45003 에 이어서):
--   45004 = 그런 초대 코드가 없음
--   45005 = 이미 초대 코드를 입력한 계정
--   45006 = 자기 코드를 입력

-- 아직 지급되지 않은 건만 훑는 조회가 잦다. 부분 인덱스로 대상만 남긴다.
create index if not exists referrals_pending_inviter_idx
  on public.referrals (inviter_id) where rewarded_at is null;

/**
 * 초대 코드 입력.
 *
 * 여기서는 관계만 맺고 크레딧은 주지 않는다. 지급은 초대받은 쪽이
 * 실제로 대화한 뒤 settle_referrals 에서 일어난다.
 */
create or replace function public.enter_referral_code(p_invitee uuid, p_code text)
returns jsonb
language plpgsql
as $$
declare
  v_inviter uuid;
  v_name text;
begin
  -- 코드는 대문자로 생성된다(generate_referral_code). 입력은 아무렇게나 들어온다.
  select id, display_name into v_inviter, v_name
    from public.profiles
   where referral_code = upper(trim(p_code));

  if v_inviter is null then
    raise exception 'referral_code_not_found' using errcode = '45004';
  end if;

  -- CHECK 제약도 막지만, 여기서 걸러야 "왜 안 되는지" 를 말해줄 수 있다.
  if v_inviter = p_invitee then
    raise exception 'referral_self' using errcode = '45006';
  end if;

  insert into public.referrals (inviter_id, invitee_id)
  values (v_inviter, p_invitee)
  on conflict (invitee_id) do nothing;

  -- 충돌로 아무 행도 안 들어갔으면 이미 다른 사람 코드를 넣은 계정이다.
  if not found then
    raise exception 'referral_already_used' using errcode = '45005';
  end if;

  return jsonb_build_object('inviter_name', v_name);
end;
$$;

/**
 * 밀린 초대 보상을 정산한다.
 *
 * 대화 한 턴이 끝날 때마다 부른다. 두 방향을 한 번에 처리하는 이유:
 *
 *  - 초대받은 쪽이 대화하면 그 건이 조건을 채운다
 *  - 초대자가 하루 상한에 걸려 밀어둔 건은, 초대받은 쪽이 다시 안 오면 영영 안 풀린다.
 *    그래서 초대자 본인이 대화할 때도 자기 대기열을 훑는다.
 *
 * 상한에 걸린 건은 거절이 아니라 보류다. 다음 날 다시 후보가 된다.
 *
 * 보상 값과 상한을 인자로 받는 건 spend_credits 와 같은 이유다 —
 * 상수의 단일 출처는 packages/shared 이고, SQL에 박으면 둘이 어긋난다.
 */
create or replace function public.settle_referrals(
  p_user uuid,
  p_min_turns int,
  p_inviter_reward int,
  p_invitee_reward int,
  p_per_day int,
  p_total int
)
returns int
language plpgsql
as $$
declare
  r record;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_turns int;
  v_today_count int;
  v_total_count int;
  v_paid int := 0;
begin
  if p_min_turns < 0 or p_inviter_reward <= 0 or p_invitee_reward <= 0
     or p_per_day <= 0 or p_total <= 0 then
    raise exception 'invalid referral config' using errcode = '22023';
  end if;

  for r in
    select rf.id, rf.inviter_id, rf.invitee_id
      from public.referrals rf
     where rf.rewarded_at is null
       and (rf.invitee_id = p_user or rf.inviter_id = p_user)
     order by rf.created_at
       -- 잠그지 않으면 두 요청이 같은 건을 각각 지급한다.
       for update of rf
  loop
    -- (3) 초대받은 쪽이 실제로 대화했는지. 계정만 만들어놓는 건 소용없게 한다.
    select count(*) into v_turns
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      join public.soulmates s on s.id = c.soulmate_id
     where s.user_id = r.invitee_id
       and m.role = 'user';

    if v_turns < p_min_turns then
      continue;
    end if;

    -- (4) 초대자 상한. 걸리면 건너뛰되 rewarded_at 은 그대로 두어 다음에 다시 본다.
    select count(*) into v_today_count
      from public.referrals
     where inviter_id = r.inviter_id
       and rewarded_at is not null
       and (rewarded_at at time zone 'Asia/Seoul')::date = v_today;

    if v_today_count >= p_per_day then
      continue;
    end if;

    select count(*) into v_total_count
      from public.referrals
     where inviter_id = r.inviter_id
       and rewarded_at is not null;

    if v_total_count >= p_total then
      continue;
    end if;

    update public.referrals set rewarded_at = now() where id = r.id;

    perform public.grant_credits(
      r.inviter_id, p_inviter_reward, 'mission_reward', 'referral', r.id);
    perform public.grant_credits(
      r.invitee_id, p_invitee_reward, 'mission_reward', 'referral', r.id);

    v_paid := v_paid + 1;
  end loop;

  return v_paid;
end;
$$;

/**
 * 초대 현황.
 *
 * 읽기 전용이다. 지급은 대화할 때만 일어난다 — GET 요청이 크레딧을 만들면
 * 새로고침으로 상한을 흔들 수 있다.
 */
create or replace function public.get_referral_status(p_user uuid, p_min_turns int)
returns jsonb
language plpgsql
stable
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_code text;
  v_rewarded int;
  v_pending int;
  v_today_count int;
  v_inviter jsonb := null;
  v_inviter_name text;
  v_inviter_rewarded boolean;
  v_my_turns int;
begin
  select referral_code into v_code from public.profiles where id = p_user;
  if v_code is null then
    raise exception 'profile not found for %', p_user using errcode = '45003';
  end if;

  select count(*) filter (where rewarded_at is not null),
         count(*) filter (where rewarded_at is null),
         count(*) filter (
           where rewarded_at is not null
             and (rewarded_at at time zone 'Asia/Seoul')::date = v_today)
    into v_rewarded, v_pending, v_today_count
    from public.referrals
   where inviter_id = p_user;

  -- 내가 초대받아 왔는지.
  select p.display_name, rf.rewarded_at is not null
    into v_inviter_name, v_inviter_rewarded
    from public.referrals rf
    join public.profiles p on p.id = rf.inviter_id
   where rf.invitee_id = p_user;

  if found then
    select count(*) into v_my_turns
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      join public.soulmates s on s.id = c.soulmate_id
     where s.user_id = p_user
       and m.role = 'user';

    v_inviter := jsonb_build_object(
      'name', v_inviter_name,
      'rewarded', v_inviter_rewarded,
      'turns_left', greatest(p_min_turns - v_my_turns, 0)
    );
  end if;

  return jsonb_build_object(
    'code', v_code,
    'rewarded_count', v_rewarded,
    'pending_count', v_pending,
    'rewarded_today', v_today_count,
    'inviter', v_inviter
  );
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
