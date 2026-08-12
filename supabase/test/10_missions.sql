-- 미션 보상 검증.
--
-- 여기서 깨지면 크레딧이 공짜로 생긴다. 크레딧 차감 다음으로 위험한 자리다.
--
-- 오늘 날짜로만 수령할 수 있어서 한 번 돌리는 동안 여러 날을 흉내내려면
-- 매번 오늘 기록을 지우고 last_checkin_on 을 과거로 옮긴다.
-- 중복 수령 자체는 2번 항목에서 따로 확인한다.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-000000000009'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'mission@test.local', '{}'::jsonb);

-- 보상 값은 packages/shared 가 원천이라 인자로 넘어온다. 테스트도 같은 값을 쓴다.
\set base 5
\set bonus 10
\set every 7

\echo '--- 검증: 첫 출석 = 1일째 ---'
do $$
declare
  v jsonb;
  v_balance int;
begin
  v := public.claim_daily_checkin('00000000-0000-4000-8000-000000000009', 5, 10, 7);

  if (v ->> 'streak')::int <> 1 then
    raise exception 'FAIL: 첫 출석인데 연속이 %입니다', v ->> 'streak';
  end if;
  if (v ->> 'granted')::int <> 5 then
    raise exception 'FAIL: 5를 줘야 하는데 %를 줬습니다', v ->> 'granted';
  end if;

  select balance into v_balance from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-000000000009';
  if v_balance <> 5 then
    raise exception 'FAIL: 잔액이 5여야 하는데 %입니다', v_balance;
  end if;

  raise notice 'PASS: 첫 출석에 1일째로 5크레딧';
end;
$$;

\echo '--- 검증: 같은 날 두 번은 거절 ---'
do $$
declare
  v_balance_before int;
  v_balance_after int;
  v_streak int;
begin
  select balance into v_balance_before from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-000000000009';

  begin
    perform public.claim_daily_checkin('00000000-0000-4000-8000-000000000009', 5, 10, 7);
    raise exception 'FAIL: 같은 날 두 번 받았습니다';
  exception
    when sqlstate '45002' then
      null;
  end;

  select balance, checkin_streak into v_balance_after, v_streak
    from public.credit_wallets where user_id = '00000000-0000-4000-8000-000000000009';

  -- 거절된 호출이 연속만 올려놓고 롤백되지 않으면 다음 날 보너스가 앞당겨진다.
  if v_balance_after <> v_balance_before then
    raise exception 'FAIL: 거절됐는데 잔액이 %에서 %로 바뀌었습니다', v_balance_before, v_balance_after;
  end if;
  if v_streak <> 1 then
    raise exception 'FAIL: 거절됐는데 연속이 %가 됐습니다', v_streak;
  end if;

  raise notice 'PASS: 하루 한 번만 받고, 거절되면 연속도 그대로입니다';
end;
$$;

\echo '--- 검증: 어제 왔으면 연속이 이어진다 ---'
do $$
declare
  v jsonb;
begin
  -- 3일 연속 상태에서 오늘 다시 온 상황을 만든다.
  delete from public.mission_completions
   where user_id = '00000000-0000-4000-8000-000000000009'
     and period_key = ((now() at time zone 'Asia/Seoul')::date)::text;
  update public.credit_wallets
     set last_checkin_on = (now() at time zone 'Asia/Seoul')::date - 1,
         checkin_streak = 3
   where user_id = '00000000-0000-4000-8000-000000000009';

  v := public.claim_daily_checkin('00000000-0000-4000-8000-000000000009', 5, 10, 7);

  if (v ->> 'streak')::int <> 4 then
    raise exception 'FAIL: 4일째여야 하는데 %입니다', v ->> 'streak';
  end if;
  if (v ->> 'granted')::int <> 5 then
    raise exception 'FAIL: 보너스 날이 아닌데 %를 줬습니다', v ->> 'granted';
  end if;

  raise notice 'PASS: 어제 출석했으면 이어집니다';
end;
$$;

\echo '--- 검증: 7일째에 보너스 ---'
do $$
declare
  v jsonb;
begin
  delete from public.mission_completions
   where user_id = '00000000-0000-4000-8000-000000000009'
     and period_key = ((now() at time zone 'Asia/Seoul')::date)::text;
  update public.credit_wallets
     set last_checkin_on = (now() at time zone 'Asia/Seoul')::date - 1,
         checkin_streak = 6
   where user_id = '00000000-0000-4000-8000-000000000009';

  v := public.claim_daily_checkin('00000000-0000-4000-8000-000000000009', 5, 10, 7);

  if (v ->> 'streak')::int <> 7 then
    raise exception 'FAIL: 7일째여야 하는데 %입니다', v ->> 'streak';
  end if;
  if (v ->> 'granted')::int <> 15 then
    raise exception 'FAIL: 5+10=15를 줘야 하는데 %를 줬습니다', v ->> 'granted';
  end if;
  if (v ->> 'bonus')::int <> 10 then
    raise exception 'FAIL: 보너스가 %입니다', v ->> 'bonus';
  end if;

  raise notice 'PASS: 7일 연속이면 보너스가 붙습니다';
end;
$$;

\echo '--- 검증: 하루라도 빠지면 처음부터 ---'
do $$
declare
  v jsonb;
begin
  delete from public.mission_completions
   where user_id = '00000000-0000-4000-8000-000000000009'
     and period_key = ((now() at time zone 'Asia/Seoul')::date)::text;
  update public.credit_wallets
     set last_checkin_on = (now() at time zone 'Asia/Seoul')::date - 3,
         checkin_streak = 9
   where user_id = '00000000-0000-4000-8000-000000000009';

  v := public.claim_daily_checkin('00000000-0000-4000-8000-000000000009', 5, 10, 7);

  if (v ->> 'streak')::int <> 1 then
    raise exception 'FAIL: 끊겼으면 1이어야 하는데 %입니다', v ->> 'streak';
  end if;

  raise notice 'PASS: 이틀 이상 비면 1일째로 돌아갑니다';
end;
$$;

\echo '--- 검증: 조회는 끊긴 연속을 미리 0으로 보여준다 ---'
do $$
declare
  v jsonb;
begin
  -- 저장된 값을 그대로 내보내면 "9일째" 라고 떠 있다가 받는 순간 1로 떨어진다.
  update public.credit_wallets
     set last_checkin_on = (now() at time zone 'Asia/Seoul')::date - 5,
         checkin_streak = 9
   where user_id = '00000000-0000-4000-8000-000000000009';

  v := public.get_checkin_state('00000000-0000-4000-8000-000000000009');

  if (v ->> 'streak')::int <> 0 then
    raise exception 'FAIL: 끊긴 연속을 %로 보여줍니다', v ->> 'streak';
  end if;
  if (v ->> 'claimed_today')::boolean then
    raise exception 'FAIL: 오늘 안 받았는데 받았다고 합니다';
  end if;

  raise notice 'PASS: 끊긴 연속은 조회 시점에 0으로 보입니다';
end;
$$;

\echo '--- 검증: 1회성 미션은 딱 한 번 ---'
do $$
declare
  v jsonb;
begin
  v := public.claim_mission('00000000-0000-4000-8000-000000000009', 'onboarding_complete', 'once', 20);
  if (v ->> 'granted')::int <> 20 then
    raise exception 'FAIL: 20을 줘야 하는데 %를 줬습니다', v ->> 'granted';
  end if;

  begin
    perform public.claim_mission('00000000-0000-4000-8000-000000000009', 'onboarding_complete', 'once', 20);
    raise exception 'FAIL: 1회성 미션을 두 번 받았습니다';
  exception
    when sqlstate '45002' then
      raise notice 'PASS: onboarding_complete 는 계정당 한 번입니다';
  end;
end;
$$;

\echo '--- 검증: 원장 합계 == 잔액 ---'
do $$
declare
  v_broken int;
begin
  -- 미션 지급도 grant_credits 를 거치므로 이 불변식이 유지돼야 한다.
  select count(*) into v_broken from public.audit_wallet_integrity();
  if v_broken <> 0 then
    raise exception 'FAIL: 원장과 잔액이 어긋난 지갑이 %건 있습니다', v_broken;
  end if;

  raise notice 'PASS: 미션 지급 후에도 원장 합계 == 잔액';
end;
$$;
