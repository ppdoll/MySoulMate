-- create_soulmate / replace_soulmate_avatar 검증.
-- 한 함수가 4개 테이블에 5번 쓰므로 부분 실패가 없는지, 계보가 이어지는지 확인한다.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-000000000002'''
\set sid '''00000000-0000-4000-8000-0000000000a1'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'soulmate@test.local', '{"full_name": "소울메이트 테스트"}'::jsonb);

select public.create_soulmate(
  :uid,
  :sid,
  '하린',
  'friend',
  '{"name":"하린","oneLiner":"먼저 말 걸어주는 사람"}'::jsonb,
  '{"archetype":"sunlight","presentation":"feminine","vibe":"bright"}'::jsonb,
  'user/soulmate/first.webp',
  'first prompt',
  '안녕, 오늘 하루 어땠어?'
) as created \gset

\echo '--- 생성 결과 ---'
select s.name,
       s.tone,
       (s.current_avatar_id is not null) as has_current_avatar,
       (select count(*) from public.soulmate_avatars a where a.soulmate_id = s.id) as avatars,
       (select count(*) from public.conversations c where c.soulmate_id = s.id) as conversations,
       (select count(*) from public.messages m
          join public.conversations c on c.id = m.conversation_id
         where c.soulmate_id = s.id) as messages
  from public.soulmates s
 where s.id = :sid;

-- 아바타 재생성: 새 행이 생기고 현재 아바타가 바뀌며 계보가 이어져야 한다.
select public.replace_soulmate_avatar(
  :uid,
  :sid,
  'user/soulmate/second.webp',
  'second prompt',
  (select current_avatar_id from public.soulmates where id = :sid)
);

\echo '--- 검증 ---'
do $$
declare
  v_avatars int;
  v_current uuid;
  v_source uuid;
  v_greeting text;
  v_msgs int;
begin
  select count(*) into v_avatars
    from public.soulmate_avatars where soulmate_id = '00000000-0000-4000-8000-0000000000a1';
  if v_avatars <> 2 then
    raise exception 'FAIL: 아바타가 2건이어야 하는데 %건입니다 (이전 행을 지우면 안 됩니다)', v_avatars;
  end if;

  select current_avatar_id into v_current
    from public.soulmates where id = '00000000-0000-4000-8000-0000000000a1';
  select source_avatar_id into v_source
    from public.soulmate_avatars where id = v_current;
  if v_source is null then
    raise exception 'FAIL: 재생성 아바타에 source_avatar_id가 없습니다 (계보 끊김)';
  end if;

  select count(*), max(content) into v_msgs, v_greeting
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.soulmate_id = '00000000-0000-4000-8000-0000000000a1';
  if v_msgs <> 1 or v_greeting is null then
    raise exception 'FAIL: 첫 인사말이 메시지로 저장되지 않았습니다 (%건)', v_msgs;
  end if;

  raise notice 'PASS: 소울메이트 생성 트랜잭션과 아바타 계보가 정상입니다';
end;
$$;

-- 이미지 생성이 실패한 경우: 아바타 없이도 소울메이트가 만들어져야 한다.
\echo '--- 아바타 없이 생성 ---'
insert into auth.users (id, email, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000003', 'noavatar@test.local', '{}'::jsonb);

select public.create_soulmate(
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-0000000000a2',
  '이든',
  'mentor',
  '{"name":"이든"}'::jsonb,
  '{"archetype":"steady","presentation":"neutral","vibe":"calm"}'::jsonb,
  null,   -- 아바타 실패
  null,
  '안녕하세요, 무슨 일 있으셨어요?'
);

do $$
declare
  v_current uuid;
  v_avatars int;
  v_msgs int;
begin
  select current_avatar_id into v_current
    from public.soulmates where id = '00000000-0000-4000-8000-0000000000a2';
  select count(*) into v_avatars
    from public.soulmate_avatars where soulmate_id = '00000000-0000-4000-8000-0000000000a2';
  select count(*) into v_msgs
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.soulmate_id = '00000000-0000-4000-8000-0000000000a2';

  if v_current is not null then
    raise exception 'FAIL: 아바타를 안 넘겼는데 current_avatar_id가 채워졌습니다';
  end if;
  if v_avatars <> 0 then
    raise exception 'FAIL: 아바타 행이 %건 생겼습니다 (0이어야 함)', v_avatars;
  end if;
  -- 대화와 인사말은 아바타와 무관하게 만들어져야 한다.
  if v_msgs <> 1 then
    raise exception 'FAIL: 아바타가 없다고 인사말까지 빠졌습니다 (%건)', v_msgs;
  end if;

  raise notice 'PASS: 아바타 없이도 소울메이트와 대화 스레드가 생성됩니다';
end;
$$;

-- 나중에 첫 아바타를 채우면 정상적으로 붙어야 한다.
select public.replace_soulmate_avatar(
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-0000000000a2',
  'user/soulmate/late-first.webp',
  'late first prompt',
  null   -- 이전 아바타가 없으므로 source 없음
);

do $$
declare
  v_current uuid;
begin
  select current_avatar_id into v_current
    from public.soulmates where id = '00000000-0000-4000-8000-0000000000a2';
  if v_current is null then
    raise exception 'FAIL: 나중에 만든 첫 아바타가 붙지 않았습니다';
  end if;
  raise notice 'PASS: 비어 있던 아바타를 나중에 채울 수 있습니다';
end;
$$;

-- 남의 소울메이트는 건드릴 수 없어야 한다.
\echo '--- 소유권 검사 ---'
do $$
begin
  begin
    perform public.replace_soulmate_avatar(
      '00000000-0000-4000-8000-000000000001',  -- 다른 사용자
      '00000000-0000-4000-8000-0000000000a1',
      'x.webp', 'x', null
    );
    raise exception 'FAIL: 다른 사용자가 아바타를 교체할 수 있었습니다';
  exception
    when sqlstate '45004' then
      raise notice 'PASS: 남의 소울메이트 교체가 차단됩니다';
  end;
end;
$$;
