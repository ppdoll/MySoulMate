-- 소울메이트 다시 만들기.
--
-- 원장 사유를 하나 추가한다. packages/shared 의 CREDIT_REASONS 와 1:1로 유지해야 한다.
-- ALTER TYPE ... ADD VALUE 로 추가한 값은 같은 트랜잭션 안에서 바로 쓸 수 없으므로
-- 이 마이그레이션에서는 선언만 하고 사용은 애플리케이션에서 한다.
alter type public.credit_reason add value if not exists 'soulmate_reset_spend';

-- 소울메이트를 지운다. 아바타/대화/메시지는 FK cascade 로 함께 지워진다.
-- Storage 파일은 DB가 모르므로 애플리케이션이 따로 지운다.
--
-- 소유권을 함수 안에서 확인한다. 컨트롤러에서만 확인하면
-- 나중에 다른 경로가 생겼을 때 검사가 빠질 수 있다.
create or replace function public.delete_soulmate(p_user uuid, p_soulmate_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_deleted int;
begin
  delete from public.soulmates
   where id = p_soulmate_id
     and user_id = p_user;

  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'soulmate not found for user' using errcode = '45004';
  end if;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
