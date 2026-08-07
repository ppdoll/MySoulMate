-- pgbench가 클라이언트마다 실행하는 스크립트.
-- 무료 쿼터 없이(allowance 0) 1크레딧씩 차감한다.
-- 잔액이 바닥나면 45001로 실패하는데, pgbench는 실패를 세어주므로 그대로 둔다.
select public.spend_credits(
  '00000000-0000-4000-8000-000000000001'::uuid,
  1,
  'chat_spend'::public.credit_reason,
  0
);
