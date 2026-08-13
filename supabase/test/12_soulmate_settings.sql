-- 비파괴적 설정 수정 검증.
--
-- 이 기능이 존재하는 이유가 하나다: 이름 하나 바꾸려고 대화와 기억을 날리지 않는 것.
-- 그래서 여기서 제일 중요한 검증은 "안 바뀐 것들이 그대로인지" 다.
\set ON_ERROR_STOP on

\set owner  '''00000000-0000-4000-8000-00000000001a'''
\set other  '''00000000-0000-4000-8000-00000000001b'''
\set sid    '''00000000-0000-4000-8000-0000000000e1'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:owner, 'editowner@test.local', '{}'::jsonb),
  (:other, 'editother@test.local', '{}'::jsonb);

select public.create_soulmate(
  :owner, :sid, '수정전', 'friend',
  '{"name":"수정전","oneLiner":"왔구나","traits":["활발한","다정한","든든한"],
    "speechStyle":"casual","speechSamples":["왔어?","오늘 뭐 했어? 나는 계속 기다렸지."],
    "backstory":"동네 카페에서 자주 마주치던 사이","interests":["산책","음악"],
    "greeting":"안녕!","appearancePrompt":"a woman with short hair"}'::jsonb,
  '{"archetype":"sunlight","presentation":"feminine","vibe":"bright","presetId":"bright"}'::jsonb,
  null, null, '안녕!'
);

-- 지켜져야 할 것들을 미리 쌓아둔다.
do $$
declare
  v_conv uuid;
begin
  select id into v_conv from public.conversations
   where soulmate_id = '00000000-0000-4000-8000-0000000000e1';

  insert into public.messages (conversation_id, role, content) values
    (v_conv, 'user', '오늘 발표 잘 됐어'), (v_conv, 'assistant', '잘했네!');

  insert into public.memories (soulmate_id, kind, content, importance, pinned) values
    ('00000000-0000-4000-8000-0000000000e1', 'fact', '고양이 이름이 나비다', 2, true);

  perform public.grant_credits(
    '00000000-0000-4000-8000-00000000001a', 50, 'admin_adjust', null, null);
end;
$$;

\echo '--- 검증: 빈 이름은 거절 ---'
do $$
begin
  begin
    perform public.update_soulmate_settings(
      '00000000-0000-4000-8000-00000000001a',
      '00000000-0000-4000-8000-0000000000e1',
      '   ', 'friend');
    raise exception 'FAIL: 빈 이름이 통과했습니다';
  exception
    when sqlstate '22023' then
      raise notice 'PASS: 빈 이름은 막힙니다';
  end;
end;
$$;

\echo '--- 검증: 남의 소울메이트는 못 고친다 ---'
do $$
declare
  v_name text;
begin
  begin
    perform public.update_soulmate_settings(
      '00000000-0000-4000-8000-00000000001b',   -- 다른 사용자
      '00000000-0000-4000-8000-0000000000e1',
      '탈취', 'partner');
    raise exception 'FAIL: 남의 소울메이트를 고쳤습니다';
  exception
    when sqlstate '45003' then null;
  end;

  select name into v_name from public.soulmates
   where id = '00000000-0000-4000-8000-0000000000e1';
  if v_name <> '수정전' then
    raise exception 'FAIL: 거절됐는데 이름이 %로 바뀌었습니다', v_name;
  end if;

  raise notice 'PASS: 소유자만 고칠 수 있고, 거절되면 아무것도 안 바뀝니다';
end;
$$;

\echo '--- 검증: 바꾼 것만 바뀌고 나머지는 그대로 ---'
do $$
declare
  s public.soulmates;
begin
  perform public.update_soulmate_settings(
    '00000000-0000-4000-8000-00000000001a',
    '00000000-0000-4000-8000-0000000000e1',
    '수정후', 'partner',
    '{"name":"수정후","speechStyle":"polite","oneLiner":"오셨네요",
      "speechSamples":["오셨어요?","오늘 뭐 하셨어요? 저는 계속 기다렸어요."]}'::jsonb,
    '{"presetId":"calm","vibe":"calm","presentation":"feminine"}'::jsonb
  );

  select * into s from public.soulmates
   where id = '00000000-0000-4000-8000-0000000000e1';

  -- 바뀌어야 하는 것
  if s.name <> '수정후' then
    raise exception 'FAIL: 이름이 %입니다', s.name;
  end if;
  if s.tone <> 'partner' then
    raise exception 'FAIL: 관계가 %입니다', s.tone;
  end if;
  -- 화면(soulmates.name)과 프롬프트(persona.name)가 갈리면 부르는 이름이 달라진다.
  if s.persona ->> 'name' <> '수정후' then
    raise exception 'FAIL: persona.name 이 %입니다', s.persona ->> 'name';
  end if;
  if s.persona ->> 'speechStyle' <> 'polite' then
    raise exception 'FAIL: 말투가 %입니다', s.persona ->> 'speechStyle';
  end if;
  if s.appearance ->> 'presetId' <> 'calm' or s.appearance ->> 'vibe' <> 'calm' then
    raise exception 'FAIL: 프리셋/분위기가 % / %입니다',
      s.appearance ->> 'presetId', s.appearance ->> 'vibe';
  end if;

  -- 그대로여야 하는 것. jsonb 를 통째로 덮어쓰면 여기가 사라진다.
  if s.persona ->> 'backstory' <> '동네 카페에서 자주 마주치던 사이' then
    raise exception 'FAIL: backstory 가 날아갔습니다: %', s.persona ->> 'backstory';
  end if;
  if jsonb_array_length(s.persona -> 'traits') <> 3 then
    raise exception 'FAIL: traits 가 %개입니다', jsonb_array_length(s.persona -> 'traits');
  end if;
  if s.persona ->> 'appearancePrompt' is null then
    raise exception 'FAIL: appearancePrompt 가 사라졌습니다';
  end if;
  -- archetype 은 아바타를 다시 그릴 때 출발점이라 남아야 한다.
  if s.appearance ->> 'archetype' <> 'sunlight' then
    raise exception 'FAIL: archetype 이 %입니다', s.appearance ->> 'archetype';
  end if;

  raise notice 'PASS: 지정한 필드만 병합되고 나머지 persona/appearance 는 남습니다';
end;
$$;

\echo '--- 검증: 대화와 기억이 살아있고 크레딧도 안 나갔다 ---'
do $$
declare
  v_messages int;
  v_memories int;
  v_pinned boolean;
  v_balance int;
begin
  select count(*) into v_messages
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.soulmate_id = '00000000-0000-4000-8000-0000000000e1';

  select count(*), bool_or(pinned) into v_memories, v_pinned
    from public.memories where soulmate_id = '00000000-0000-4000-8000-0000000000e1';

  select balance into v_balance from public.credit_wallets
   where user_id = '00000000-0000-4000-8000-00000000001a';

  -- 이게 이 기능의 존재 이유다. delete_soulmate 로 바꾸던 시절엔 전부 0이 됐다.
  -- 3건 = create_soulmate 가 넣는 첫 인사 1건 + 위에서 넣은 2건.
  if v_messages <> 3 then
    raise exception 'FAIL: 대화가 %건 남았습니다 (3건이어야 함)', v_messages;
  end if;
  if v_memories <> 1 or not v_pinned then
    raise exception 'FAIL: 기억이 사라졌거나 고정이 풀렸습니다 (건수=% 고정=%)',
      v_memories, v_pinned;
  end if;
  if v_balance <> 50 then
    raise exception 'FAIL: 무료여야 하는데 잔액이 50에서 %로 바뀌었습니다', v_balance;
  end if;

  raise notice 'PASS: 대화 3건 / 고정 기억 1건 그대로, 크레딧도 그대로';
end;
$$;
