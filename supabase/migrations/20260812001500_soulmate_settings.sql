-- 소울메이트 설정 수정 (비파괴적).
--
-- 지금까지 이름 하나 바꾸려면 delete_soulmate(20크레딧) 뿐이었다.
-- 대화 기록과 기억까지 함께 사라진다. 관계가 쌓인 뒤에는 사실상 못 바꾸는 것과 같았다.
--
-- 여기서 바꾸는 건 비용이 0인 것들뿐이다 — 이름, 관계 톤, 말투, 프리셋 모습.
-- 얼굴을 새로 그리는 건 이미지 생성 비용이 드니 여전히 재생성(10크레딧)이다.
--
-- jsonb 를 통째로 다시 쓰지 않고 `||` 로 병합하는 이유:
-- 애플리케이션에서 읽고-고치고-쓰는 사이에 다른 요청(아바타 교체 등)이 같은 컬럼을
-- 건드리면 그 변경을 덮어쓴다. 병합은 한 문장이라 그 틈이 없다.
create or replace function public.update_soulmate_settings(
  p_user uuid,
  p_soulmate_id uuid,
  p_name text,
  p_tone public.relationship_tone,
  p_persona_patch jsonb default '{}'::jsonb,
  p_appearance_patch jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name must not be empty' using errcode = '22023';
  end if;

  update public.soulmates
     set name = btrim(p_name),
         tone = p_tone,
         persona = persona || coalesce(p_persona_patch, '{}'::jsonb),
         appearance = appearance || coalesce(p_appearance_patch, '{}'::jsonb),
         updated_at = now()
   where id = p_soulmate_id
     and user_id = p_user;

  -- 남의 소울메이트 id 를 넣어도 여기로 떨어진다. 있는지 없는지도 알려주지 않는다.
  if not found then
    raise exception 'soulmate not found' using errcode = '45003';
  end if;
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
