-- 무료 쿼터 검증.
--
-- 03_assert.sql 은 freeAllowance=0 (아바타 경로)만 다뤄서
-- 정작 대화가 쓰는 무료 쿼터 경로가 한 번도 실행되지 않았다.
-- 여기서 소모 순서, 소진 후 거절, 자정 리셋을 확인한다.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-000000000005'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'quota@test.local', '{}'::jsonb);

-- 유료 잔액 3을 만든다. 무료 허용량은 매 호출에 2를 넘긴다.
select public.grant_credits(:uid, 3, 'purchase', 'test', null);

\echo '--- 무료 2 + 유료 3 상태에서 1씩 5번 차감 ---'
select step,
       (r->>'free_used')::int  as free_used,
       (r->>'paid_used')::int  as paid_used,
       (r->>'balance')::int    as balance,
       (r->>'free_used_today')::int as free_today
  from (
    select 1 as step, public.spend_credits(:uid, 1, 'chat_spend', 2) as r
    union all select 2, public.spend_credits(:uid, 1, 'chat_spend', 2)
    union all select 3, public.spend_credits(:uid, 1, 'chat_spend', 2)
    union all select 4, public.spend_credits(:uid, 1, 'chat_spend', 2)
    union all select 5, public.spend_credits(:uid, 1, 'chat_spend', 2)
  ) t
 order by step;

\echo '--- 검증: 무료가 먼저 소모되고, 소진 후 유료로 넘어가며, 다 쓰면 거절 ---'
do $$
declare
  v_balance int;
  v_free int;
  v_chat_rows int;
  v_ledger bigint;
begin
  select balance, free_used_today into v_balance, v_free
    from public.credit_wallets where user_id = '00000000-0000-4000-8000-000000000005';

  -- 무료 2 + 유료 3 = 5회를 썼으므로 둘 다 바닥이어야 한다.
  if v_free <> 2 then
    raise exception 'FAIL: 무료 사용량이 2여야 하는데 %입니다', v_free;
  end if;
  if v_balance <> 0 then
    raise exception 'FAIL: 잔액이 0이어야 하는데 %입니다', v_balance;
  end if;

  -- 원장에는 유료로 나간 3건만 남아야 한다. 무료 사용분은 기록하지 않는다.
  select count(*) into v_chat_rows
    from public.credit_ledger
   where user_id = '00000000-0000-4000-8000-000000000005' and reason = 'chat_spend';
  if v_chat_rows <> 3 then
    raise exception 'FAIL: chat_spend 원장이 3건이어야 하는데 %건입니다 (무료분이 기록됨?)', v_chat_rows;
  end if;

  -- 불변식
  select coalesce(sum(delta), 0) into v_ledger
    from public.credit_ledger where user_id = '00000000-0000-4000-8000-000000000005';
  if v_ledger <> v_balance then
    raise exception 'FAIL: 원장 합계(%)와 잔액(%)이 다릅니다', v_ledger, v_balance;
  end if;

  -- 여섯 번째는 거절되어야 한다.
  begin
    perform public.spend_credits('00000000-0000-4000-8000-000000000005', 1, 'chat_spend', 2);
    raise exception 'FAIL: 무료와 잔액이 모두 0인데 차감이 성공했습니다';
  exception
    when sqlstate '45001' then null;
  end;

  raise notice 'PASS: 무료 -> 유료 순서로 소모되고, 무료분은 원장에 남지 않으며, 소진 후 45001로 거절됩니다';
end;
$$;

\echo '--- 자정 리셋 (lazy reset) ---'
do $$
declare
  v_free int;
  v_reset timestamptz;
  r jsonb;
begin
  -- 리셋 시각을 과거로 돌려 "자정이 지난" 상태를 만든다.
  update public.credit_wallets
     set free_reset_at = now() - interval '1 minute'
   where user_id = '00000000-0000-4000-8000-000000000005';

  -- 잔액은 여전히 0이지만 무료 쿼터가 살아났으므로 통과해야 한다.
  r := public.spend_credits('00000000-0000-4000-8000-000000000005', 1, 'chat_spend', 2);

  if (r->>'free_used')::int <> 1 then
    raise exception 'FAIL: 리셋 후 무료로 차감되지 않았습니다 (free_used=%)', r->>'free_used';
  end if;
  if (r->>'paid_used')::int <> 0 then
    raise exception 'FAIL: 잔액이 0인데 유료로 차감됐습니다';
  end if;

  select free_used_today, free_reset_at into v_free, v_reset
    from public.credit_wallets where user_id = '00000000-0000-4000-8000-000000000005';

  if v_free <> 1 then
    raise exception 'FAIL: 리셋 후 사용량이 1이어야 하는데 %입니다', v_free;
  end if;
  if v_reset <= now() then
    raise exception 'FAIL: 리셋 시각이 미래로 갱신되지 않았습니다 (%)', v_reset;
  end if;

  raise notice 'PASS: 리셋 시각이 지나면 무료 쿼터가 살아나고 다음 자정으로 갱신됩니다';
end;
$$;

\echo '--- 환불 (모델 실패 시) ---'
do $$
declare
  r jsonb;
  v_free_before int;
  v_free_after int;
begin
  select free_used_today into v_free_before
    from public.credit_wallets where user_id = '00000000-0000-4000-8000-000000000005';

  -- 무료로 나간 1건을 되돌린다.
  perform public.refund_credits('00000000-0000-4000-8000-000000000005', 1, 0, 'conversation', null);

  select free_used_today into v_free_after
    from public.credit_wallets where user_id = '00000000-0000-4000-8000-000000000005';

  if v_free_after <> v_free_before - 1 then
    raise exception 'FAIL: 무료 사용량이 되돌려지지 않았습니다 (% -> %)', v_free_before, v_free_after;
  end if;

  raise notice 'PASS: 무료로 나간 분량도 환불됩니다';
end;
$$;
