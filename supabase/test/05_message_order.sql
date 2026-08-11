-- 메시지 순서 검증.
--
-- 사용자 질문과 응답을 한 번의 INSERT 로 넣으면 created_at 이 완전히 같다.
-- (now() 는 트랜잭션 시작 시각이라 행마다 달라지지 않는다)
-- 예전에는 보조 정렬키가 랜덤 UUID 라 새로고침할 때마다 순서가 뒤집혔다.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-000000000004'''
\set sid '''00000000-0000-4000-8000-0000000000b1'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'order@test.local', '{}'::jsonb);

select public.create_soulmate(
  :uid, :sid, '순서', 'friend',
  '{"name":"순서"}'::jsonb,
  '{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"calm"}'::jsonb,
  null, null, '안녕!'
);

-- 애플리케이션과 같은 방식: 질문과 응답을 한 문장으로 함께 넣는다.
do $$
declare
  v_conv uuid;
  i int;
begin
  select id into v_conv from public.conversations
   where soulmate_id = '00000000-0000-4000-8000-0000000000b1';

  for i in 1..3 loop
    insert into public.messages (conversation_id, role, content) values
      (v_conv, 'user',      format('질문 %s', i)),
      (v_conv, 'assistant', format('응답 %s', i));
  end loop;
end;
$$;

\echo '--- created_at 이 실제로 같은지 (문제의 원인) ---'
select count(*) as rows_sharing_timestamp
  from (
    select m.created_at
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where c.soulmate_id = '00000000-0000-4000-8000-0000000000b1'
     group by m.created_at
    having count(*) > 1
  ) t;

\echo '--- seq 순 정렬 결과 ---'
select m.seq, m.role, m.content
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
 where c.soulmate_id = '00000000-0000-4000-8000-0000000000b1'
 order by m.seq;

\echo '--- 검증 ---'
do $$
declare
  r record;
  v_expected text;
  i int := 0;
begin
  -- 인사말 -> (질문, 응답) x3 순서여야 한다.
  for r in
    select m.role, m.content
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
     where c.soulmate_id = '00000000-0000-4000-8000-0000000000b1'
     order by m.seq
  loop
    i := i + 1;
    v_expected := case
      when i = 1 then 'assistant'          -- 첫 인사말
      when i % 2 = 0 then 'user'
      else 'assistant'
    end;
    if r.role::text <> v_expected then
      raise exception 'FAIL: %번째가 %여야 하는데 %입니다 (내용: %)', i, v_expected, r.role, r.content;
    end if;
  end loop;

  if i <> 7 then
    raise exception 'FAIL: 메시지가 7건이어야 하는데 %건입니다', i;
  end if;

  raise notice 'PASS: 질문 -> 응답 순서가 seq 로 고정됩니다';
end;
$$;

-- seq 가 대화 안에서 단조 증가하는지
do $$
declare
  v_dups int;
begin
  select count(*) into v_dups
    from (
      select seq from public.messages group by seq having count(*) > 1
    ) t;
  if v_dups > 0 then
    raise exception 'FAIL: seq 가 중복됩니다 (%건)', v_dups;
  end if;
  raise notice 'PASS: seq 중복 없음';
end;
$$;
