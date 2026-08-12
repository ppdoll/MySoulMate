-- 출석 연속 일수.
--
-- 무료 유저는 하루 30턴을 쓰고 나면 갈 곳이 없다. 결제(M6)는 Vercel Pro 전환이
-- 선행돼야 하므로, 미션이 지금 유일한 충전 경로다.
--
-- 매일 같은 양만 주면 하루 빠져도 잃는 게 없다. 연속을 세야 돌아올 이유가 생긴다.
--
-- 지갑에 두는 이유: 보상 지급이 이미 credit_wallets 행을 잠근다.
-- 같은 트랜잭션 안에서 갱신하면 연속 계산과 지급이 원자적으로 붙는다.
alter table public.credit_wallets
  add column if not exists checkin_streak int not null default 0
    check (checkin_streak >= 0),
  -- 마지막으로 출석한 날(KST). timestamptz 로 두면 자정 경계에서 하루가 어긋난다.
  add column if not exists last_checkin_on date;

/**
 * 일일 출석 수령.
 *
 * 보상 값을 인자로 받는 이유는 spend_credits 와 같다 — 상수의 단일 출처는
 * packages/shared 이고, SQL에 숫자를 박아두면 둘이 어긋난다.
 *
 * 중복 수령의 최종 방어선은 claim_mission 안의 UNIQUE 제약이다.
 * 여기서는 그 앞에 연속 계산만 얹는다.
 */
create or replace function public.claim_daily_checkin(
  p_user uuid,
  p_base int,
  p_bonus int,
  p_bonus_every int
)
returns jsonb
language plpgsql
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_last date;
  v_streak int;
  v_reward int;
  v_bonus int := 0;
  v_result jsonb;
begin
  if p_base <= 0 or p_bonus < 0 or p_bonus_every <= 0 then
    raise exception 'invalid checkin reward config' using errcode = '22023';
  end if;

  -- 잠가둔 채로 읽는다. 탭 두 개에서 동시에 눌러도 연속이 두 번 오르지 않는다.
  select last_checkin_on, checkin_streak
    into v_last, v_streak
    from public.credit_wallets
   where user_id = p_user
     for update;

  if not found then
    raise exception 'wallet not found for %', p_user using errcode = '45003';
  end if;

  -- 어제 받았으면 잇고, 아니면 오늘이 1일차다.
  if v_last = v_today - 1 then
    v_streak := v_streak + 1;
  else
    v_streak := 1;
  end if;

  v_reward := p_base;
  if v_streak % p_bonus_every = 0 then
    v_bonus := p_bonus;
  end if;

  -- 오늘 이미 받았다면 여기서 45002 가 올라오고 위 갱신은 전부 롤백된다.
  v_result := public.claim_mission(p_user, 'daily_check_in', v_today::text, v_reward + v_bonus);

  update public.credit_wallets
     set checkin_streak = v_streak,
         last_checkin_on = v_today,
         updated_at = now()
   where user_id = p_user;

  return v_result || jsonb_build_object('streak', v_streak, 'bonus', v_bonus);
end;
$$;

/**
 * 출석 상태 조회. 읽기 전용이라 연속이 끊겼는지도 계산만 한다.
 *
 * 어제도 그제도 안 왔으면 화면에 이미 0으로 보여야 한다.
 * 저장된 값을 그대로 내보내면 "3일째" 라고 떠 있다가 받는 순간 1로 떨어진다.
 */
create or replace function public.get_checkin_state(p_user uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_last date;
  v_streak int;
begin
  select last_checkin_on, checkin_streak
    into v_last, v_streak
    from public.credit_wallets
   where user_id = p_user;

  if not found then
    return jsonb_build_object('claimed_today', false, 'streak', 0);
  end if;

  if v_last is distinct from v_today and v_last is distinct from v_today - 1 then
    v_streak := 0;
  end if;

  return jsonb_build_object(
    'claimed_today', v_last = v_today,
    'streak', coalesce(v_streak, 0)
  );
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
