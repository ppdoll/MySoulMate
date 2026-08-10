-- 아바타 없이도 소울메이트를 만들 수 있게 한다.
--
-- 이미지 생성은 텍스트보다 실패 확률이 높다(결제 미설정, 분당 한도, 안전 필터).
-- 그런데 지금은 아바타가 실패하면 온보딩 전체가 실패해서,
-- 사용자가 답한 질문 10개가 통째로 날아간다.
--
-- 페르소나는 이미 만들어졌으니 그것만으로 소울메이트를 만들어 두고,
-- 아바타는 나중에 채우는 편이 낫다. 첫 아바타를 아직 못 받았으므로
-- 그 한 번은 여전히 무료여야 한다(애플리케이션에서 처리).

create or replace function public.create_soulmate(
  p_user uuid,
  p_soulmate_id uuid,
  p_name text,
  p_tone public.relationship_tone,
  p_persona jsonb,
  p_appearance jsonb,
  -- 아바타를 못 만들었으면 null로 넘긴다. 그 경우 아바타 행을 만들지 않고
  -- current_avatar_id 를 비워둔다.
  p_storage_path text,
  p_image_prompt text,
  p_greeting text
)
returns jsonb
language plpgsql
as $$
declare
  v_avatar_id uuid;
  v_conversation_id uuid;
begin
  insert into public.soulmates (id, user_id, name, tone, persona, appearance)
  values (p_soulmate_id, p_user, p_name, p_tone, p_persona, p_appearance);

  if p_storage_path is not null then
    insert into public.soulmate_avatars (soulmate_id, storage_path, prompt)
    values (p_soulmate_id, p_storage_path, coalesce(p_image_prompt, ''))
    returning id into v_avatar_id;

    update public.soulmates
       set current_avatar_id = v_avatar_id
     where id = p_soulmate_id;
  end if;

  insert into public.conversations (soulmate_id)
  values (p_soulmate_id)
  returning id into v_conversation_id;

  -- 첫 인사말을 미리 넣어두면 대화창이 빈 화면으로 시작하지 않는다.
  insert into public.messages (conversation_id, role, content)
  values (v_conversation_id, 'assistant', p_greeting);

  return jsonb_build_object(
    'soulmate_id', p_soulmate_id,
    'avatar_id', v_avatar_id,
    'conversation_id', v_conversation_id
  );
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
