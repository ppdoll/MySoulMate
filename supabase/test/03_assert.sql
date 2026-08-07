-- 동시성 테스트 결과 검증.
\set ON_ERROR_STOP on

\echo '--- 지갑 상태 ---'
select balance, free_used_today from public.credit_wallets
 where user_id = '00000000-0000-4000-8000-000000000001';

\echo '--- 원장 ---'
select reason, delta, count(*) as rows
  from public.credit_ledger
 where user_id = '00000000-0000-4000-8000-000000000001'
 group by reason, delta
 order by reason;

\echo '--- 검증 ---'
do $$
declare
  v_balance int;
  v_ledger bigint;
  v_spends bigint;
  v_broken int;
begin
  select balance into v_balance
    from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-000000000001';

  select coalesce(sum(delta), 0) into v_ledger
    from public.credit_ledger
   where user_id = '00000000-0000-4000-8000-000000000001';

  select count(*) into v_spends
    from public.credit_ledger
   where user_id = '00000000-0000-4000-8000-000000000001'
     and reason = 'chat_spend';

  select count(*) into v_broken from public.audit_wallet_integrity();

  -- 1. 잔액이 음수로 새지 않았는가 (check 제약이 있어 여기까지 오면 이미 통과지만 명시한다)
  if v_balance < 0 then
    raise exception 'FAIL: 잔액이 음수입니다 (%)', v_balance;
  end if;

  -- 2. 5크레딧으로 정확히 5번만 차감됐는가 (이중 차감/과다 차감 없음)
  if v_spends <> 5 then
    raise exception 'FAIL: chat_spend 원장이 5건이어야 하는데 %건입니다', v_spends;
  end if;

  -- 3. 전부 소진됐는가
  if v_balance <> 0 then
    raise exception 'FAIL: 잔액이 0이어야 하는데 %입니다', v_balance;
  end if;

  -- 4. 핵심 불변식: 원장 합계 == 잔액
  if v_ledger <> v_balance then
    raise exception 'FAIL: 원장 합계(%)와 잔액(%)이 다릅니다', v_ledger, v_balance;
  end if;

  if v_broken <> 0 then
    raise exception 'FAIL: audit_wallet_integrity()가 %건을 보고했습니다', v_broken;
  end if;

  raise notice 'PASS: 동시 요청 20건 중 정확히 5건만 차감되었고 원장과 잔액이 일치합니다';
end;
$$;
