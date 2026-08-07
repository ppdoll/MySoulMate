-- 동시성 테스트용 시드.
-- 잔액을 정확히 5로 만들고, 무료 쿼터는 쓰지 않는 조건(allowance 0)에서
-- 20개 요청이 동시에 1씩 차감하게 한다. 5개만 성공해야 정상이다.

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000001',
  'race@test.local',
  '{"full_name": "동시성 테스트"}'::jsonb
);

-- 트리거가 profiles와 credit_wallets를 만들었는지 확인
do $$
begin
  if not exists (select 1 from public.profiles where id = '00000000-0000-4000-8000-000000000001') then
    raise exception '가입 트리거가 프로필을 만들지 않았습니다';
  end if;
  if not exists (select 1 from public.credit_wallets where user_id = '00000000-0000-4000-8000-000000000001') then
    raise exception '가입 트리거가 지갑을 만들지 않았습니다';
  end if;
end;
$$;

-- 결제로 5크레딧을 넣은 상황을 만든다(원장에 +5가 남는다).
select public.grant_credits(
  '00000000-0000-4000-8000-000000000001',
  5,
  'purchase',
  'test',
  null
);
