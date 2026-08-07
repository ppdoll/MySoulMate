-- 소울메이트 생성/아바타 교체를 한 트랜잭션으로 묶는다.
--
-- 애플리케이션에서 나눠 쓰면 중간에 실패했을 때
-- 아바타 없는 소울메이트나 대화 스레드 없는 소울메이트가 남는다.
-- 서버리스라 재시도 지점도 일정하지 않아서 정리 코드를 신뢰하기 어렵다.
--
-- soulmate_id는 호출자가 미리 만들어 넘긴다.
-- 아바타를 Storage에 올릴 때 경로에 id가 필요한데, 그 시점엔 아직 행이 없기 때문이다.

create or replace function public.create_soulmate(
  p_user uuid,
  p_soulmate_id uuid,
  p_name text,
  p_tone public.relationship_tone,
  p_persona jsonb,
  p_appearance jsonb,
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

  insert into public.soulmate_avatars (soulmate_id, storage_path, prompt)
  values (p_soulmate_id, p_storage_path, p_image_prompt)
  returning id into v_avatar_id;

  update public.soulmates
     set current_avatar_id = v_avatar_id
   where id = p_soulmate_id;

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

-- 아바타 재생성. 새 행을 남기고 현재 아바타를 교체한다.
-- 이전 아바타 행은 지우지 않는다 — source_avatar_id로 이어진 계보가 있어야
-- 나중에 "원래 얼굴"로 되돌리거나 일관성을 추적할 수 있다.
create or replace function public.replace_soulmate_avatar(
  p_user uuid,
  p_soulmate_id uuid,
  p_storage_path text,
  p_image_prompt text,
  p_source_avatar_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_avatar_id uuid;
begin
  -- 남의 소울메이트를 건드리지 못하게 소유권을 함께 확인한다.
  if not exists (
    select 1 from public.soulmates
     where id = p_soulmate_id and user_id = p_user
  ) then
    raise exception 'soulmate not found for user' using errcode = '45004';
  end if;

  insert into public.soulmate_avatars (soulmate_id, storage_path, prompt, source_avatar_id)
  values (p_soulmate_id, p_storage_path, p_image_prompt, p_source_avatar_id)
  returning id into v_avatar_id;

  update public.soulmates
     set current_avatar_id = v_avatar_id
   where id = p_soulmate_id;

  return jsonb_build_object('avatar_id', v_avatar_id);
end;
$$;

-- 새로 만든 함수도 기본 PUBLIC EXECUTE를 회수한다.
-- 그대로 두면 로그인한 사용자가 PostgREST로 직접 호출해 남의 소울메이트를 만들 수 있다.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
