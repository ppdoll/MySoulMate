-- 친구 초대 검증.
--
-- 여기가 크레딧이 공짜로 생기는 유일한 경로다. 한 건이라도 두 번 지급되면
-- 계정을 찍어내는 것만으로 잔액을 만들 수 있다.
\set ON_ERROR_STOP on

\set inviter '''00000000-0000-4000-8000-00000000000a'''
\set invitee '''00000000-0000-4000-8000-00000000000b'''
\set sid     '''00000000-0000-4000-8000-0000000000d1'''

-- packages/shared 의 값과 같아야 한다(REFERRAL_LIMITS, MISSION_REWARDS).
\set min_turns 3
\set r_inviter 30
\set r_invitee 15
\set per_day 3
\set total 20

insert into auth.users (id, email, raw_user_meta_data) values
  (:inviter, 'inviter@test.local', '{}'::jsonb),
  (:invitee, 'invitee@test.local', '{}'::jsonb);

\echo '--- 검증: 없는 코드 / 자기 코드는 거절 ---'
do $$
declare
  v_code text;
begin
  begin
    perform public.enter_referral_code('00000000-0000-4000-8000-00000000000b', 'NOPECODE');
    raise exception 'FAIL: 없는 코드가 통과했습니다';
  exception
    when sqlstate '45004' then null;
  end;

  select referral_code into v_code from public.profiles
   where id = '00000000-0000-4000-8000-00000000000b';

  begin
    perform public.enter_referral_code('00000000-0000-4000-8000-00000000000b', v_code);
    raise exception 'FAIL: 자기 코드로 자기를 초대했습니다';
  exception
    when sqlstate '45006' then null;
  end;

  raise notice 'PASS: 없는 코드와 자기 코드는 막힙니다';
end;
$$;

\echo '--- 검증: 코드 입력만으로는 크레딧이 생기지 않는다 ---'
do $$
declare
  v_code text;
  v_balance int;
begin
  select referral_code into v_code from public.profiles
   where id = '00000000-0000-4000-8000-00000000000a';

  -- 소문자와 공백을 섞어 넣어도 받아야 한다. 코드는 대문자로 생성된다.
  perform public.enter_referral_code(
    '00000000-0000-4000-8000-00000000000b', '  ' || lower(v_code) || ' ');

  select sum(balance) into v_balance from public.credit_wallets
   where user_id in ('00000000-0000-4000-8000-00000000000a',
                     '00000000-0000-4000-8000-00000000000b');

  if v_balance <> 0 then
    raise exception 'FAIL: 아직 대화도 안 했는데 %크레딧이 생겼습니다', v_balance;
  end if;

  raise notice 'PASS: 관계만 맺히고 지급은 미뤄집니다';
end;
$$;

\echo '--- 검증: 코드는 계정당 한 번 ---'
do $$
declare
  v_code text;
begin
  -- 다른 사람 코드로 갈아타는 것도 막혀야 한다.
  select referral_code into v_code from public.profiles
   where id = '00000000-0000-4000-8000-000000000009';

  begin
    perform public.enter_referral_code('00000000-0000-4000-8000-00000000000b', v_code);
    raise exception 'FAIL: 초대 코드를 두 번 넣었습니다';
  exception
    when sqlstate '45005' then
      raise notice 'PASS: 한 계정은 평생 한 번만 초대받습니다';
  end;
end;
$$;

-- 초대받은 쪽에게 소울메이트를 만들어 준다(대화하려면 필요하다).
select public.create_soulmate(
  :invitee, :sid, '초대', 'friend',
  '{"name":"초대"}'::jsonb,
  '{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"calm"}'::jsonb,
  null, null, '안녕!'
);

\echo '--- 검증: 대화가 모자라면 지급하지 않는다 ---'
do $$
declare
  v_conv uuid;
  v_paid int;
begin
  select id into v_conv from public.conversations
   where soulmate_id = '00000000-0000-4000-8000-0000000000d1';

  -- 3턴이 조건인데 2턴만 한다.
  insert into public.messages (conversation_id, role, content) values
    (v_conv, 'user', '안녕'), (v_conv, 'assistant', '안녕!'),
    (v_conv, 'user', '뭐해'), (v_conv, 'assistant', '너 생각');

  v_paid := public.settle_referrals(
    '00000000-0000-4000-8000-00000000000b', 3, 30, 15, 3, 20);

  if v_paid <> 0 then
    raise exception 'FAIL: 2턴인데 %건 지급했습니다', v_paid;
  end if;

  raise notice 'PASS: 계정만 만들어놓는 걸로는 못 받습니다';
end;
$$;

\echo '--- 검증: 조건을 채우면 양쪽에 딱 한 번 ---'
do $$
declare
  v_conv uuid;
  v_paid int;
  v_a int;
  v_b int;
begin
  select id into v_conv from public.conversations
   where soulmate_id = '00000000-0000-4000-8000-0000000000d1';

  insert into public.messages (conversation_id, role, content)
  values (v_conv, 'user', '오늘 뭐했어'), (v_conv, 'assistant', '기다렸지');

  v_paid := public.settle_referrals(
    '00000000-0000-4000-8000-00000000000b', 3, 30, 15, 3, 20);
  if v_paid <> 1 then
    raise exception 'FAIL: 1건 지급이어야 하는데 %건입니다', v_paid;
  end if;

  select balance into v_a from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-00000000000a';
  select balance into v_b from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-00000000000b';

  if v_a <> 30 or v_b <> 15 then
    raise exception 'FAIL: 초대자 30 / 초대받은 쪽 15 여야 하는데 % / % 입니다', v_a, v_b;
  end if;

  -- 여기가 핵심이다. 대화할 때마다 부르는 함수라 두 번째부터 반드시 0이어야 한다.
  v_paid := public.settle_referrals(
    '00000000-0000-4000-8000-00000000000b', 3, 30, 15, 3, 20);
  v_paid := v_paid + public.settle_referrals(
    '00000000-0000-4000-8000-00000000000a', 3, 30, 15, 3, 20);

  if v_paid <> 0 then
    raise exception 'FAIL: 이미 지급된 건을 %번 더 지급했습니다', v_paid;
  end if;

  select balance into v_a from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-00000000000a';
  if v_a <> 30 then
    raise exception 'FAIL: 재호출 후 초대자 잔액이 %입니다', v_a;
  end if;

  raise notice 'PASS: 조건 충족 시 30/15 지급, 몇 번을 다시 불러도 한 번뿐입니다';
end;
$$;

\echo '--- 검증: 하루 상한을 넘으면 버려지지 않고 다음으로 밀린다 ---'
do $$
declare
  v_conv uuid;
  v_sid uuid := '00000000-0000-4000-8000-0000000000d2';
  v_new uuid := '00000000-0000-4000-8000-00000000000c';
  v_paid int;
  v_rewarded_at timestamptz;
  v_before int;
begin
  -- 오늘 이미 2명을 더 보상해 상한(3)을 채워둔다. 위에서 1건 지급했으므로 합이 3.
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_new, 'invitee2@test.local', '{}'::jsonb),
    ('00000000-0000-4000-8000-00000000000d', 'filler1@test.local', '{}'::jsonb),
    ('00000000-0000-4000-8000-00000000000e', 'filler2@test.local', '{}'::jsonb);

  insert into public.referrals (inviter_id, invitee_id, rewarded_at) values
    ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000d', now()),
    ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000e', now());

  -- 네 번째 사람이 조건을 다 채운다.
  insert into public.referrals (inviter_id, invitee_id)
  values ('00000000-0000-4000-8000-00000000000a', v_new);

  perform public.create_soulmate(
    v_new, v_sid, '초대2', 'friend',
    '{"name":"초대2"}'::jsonb,
    '{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"calm"}'::jsonb,
    null, null, '안녕!'
  );
  select id into v_conv from public.conversations where soulmate_id = v_sid;
  insert into public.messages (conversation_id, role, content) values
    (v_conv, 'user', 'ㅎㅇ'), (v_conv, 'user', 'ㅎㅇ2'), (v_conv, 'user', 'ㅎㅇ3');

  select balance into v_before from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-00000000000a';

  v_paid := public.settle_referrals(v_new, 3, 30, 15, 3, 20);
  if v_paid <> 0 then
    raise exception 'FAIL: 하루 상한을 넘겼는데 %건 지급했습니다', v_paid;
  end if;

  select rewarded_at into v_rewarded_at from public.referrals where invitee_id = v_new;
  if v_rewarded_at is not null then
    raise exception 'FAIL: 보류돼야 하는데 지급 처리됐습니다';
  end if;

  -- 하루가 지난 상황을 만든다. 초대자 본인이 대화할 때 대기열이 풀려야 한다 --
  -- 초대받은 쪽이 다시 오지 않으면 영영 안 풀리는 구멍을 막는 부분이다.
  update public.referrals
     set rewarded_at = now() - interval '2 day'
   where inviter_id = '00000000-0000-4000-8000-00000000000a'
     and rewarded_at is not null;

  v_paid := public.settle_referrals(
    '00000000-0000-4000-8000-00000000000a', 3, 30, 15, 3, 20);

  if v_paid <> 1 then
    raise exception 'FAIL: 다음 날 초대자가 대화했는데 %건 지급했습니다', v_paid;
  end if;

  raise notice 'PASS: 상한 초과분은 보류됐다가 초대자가 다시 오면 지급됩니다';
end;
$$;

\echo '--- 검증: 누적 상한 ---'
do $$
declare
  v_paid int;
begin
  -- 누적 상한을 2로 낮춰 부르면(이미 2건 지급됨) 더는 나가면 안 된다.
  insert into public.referrals (inviter_id, invitee_id)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000009');

  v_paid := public.settle_referrals(
    '00000000-0000-4000-8000-00000000000a', 0, 30, 15, 3, 2);

  if v_paid <> 0 then
    raise exception 'FAIL: 누적 상한을 넘겨 %건 지급했습니다', v_paid;
  end if;

  raise notice 'PASS: 누적 상한을 넘으면 지급하지 않습니다';
end;
$$;

\echo '--- 검증: 원장 합계 == 잔액 ---'
do $$
declare
  v_broken int;
begin
  select count(*) into v_broken from public.audit_wallet_integrity();
  if v_broken <> 0 then
    raise exception 'FAIL: 원장과 잔액이 어긋난 지갑이 %건 있습니다', v_broken;
  end if;

  raise notice 'PASS: 초대 지급 후에도 원장 합계 == 잔액';
end;
$$;
