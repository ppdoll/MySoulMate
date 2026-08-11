-- 장기 기억 검증.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-000000000006'''
\set sid '''00000000-0000-4000-8000-0000000000c1'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'memory@test.local', '{}'::jsonb);

select public.create_soulmate(
  :uid, :sid, '기억', 'friend',
  '{"name":"기억"}'::jsonb,
  '{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"calm"}'::jsonb,
  null, null, '안녕!'
);

-- 중요도를 섞어 넣는다. 회상은 중요도 -> 최근 순이어야 한다.
insert into public.memories (soulmate_id, kind, content, importance, created_at) values
  (:sid, 'event',      '금요일에 팀 발표가 있다',        3, now() - interval '3 day'),
  (:sid, 'fact',       '고양이 이름이 나비다',           2, now() - interval '2 day'),
  (:sid, 'concern',    '새 팀장과 부딪히는 일이 반복된다', 3, now() - interval '1 day'),
  (:sid, 'preference', '매운 음식을 못 먹는다',          1, now());

\echo '--- 회상 순서 (중요도 -> 최근) ---'
select importance, kind, content
  from public.memories
 where soulmate_id = :sid
 order by importance desc, created_at desc;

\echo '--- 검증: 회상 순서 ---'
do $$
declare
  v_first text;
  v_last text;
begin
  select content into v_first
    from public.memories where soulmate_id = '00000000-0000-4000-8000-0000000000c1'
   order by importance desc, created_at desc limit 1;

  -- importance 3 중에서 더 최근인 것이 먼저 와야 한다.
  if v_first <> '새 팀장과 부딪히는 일이 반복된다' then
    raise exception 'FAIL: 첫 기억이 예상과 다릅니다: %', v_first;
  end if;

  select content into v_last
    from public.memories where soulmate_id = '00000000-0000-4000-8000-0000000000c1'
   order by importance desc, created_at desc offset 3 limit 1;

  if v_last <> '매운 음식을 못 먹는다' then
    raise exception 'FAIL: 마지막 기억이 예상과 다릅니다: %', v_last;
  end if;

  raise notice 'PASS: 중요도 -> 최근 순으로 회상됩니다';
end;
$$;

\echo '--- 상한 정리 (prune_memories) ---'
do $$
declare
  v_deleted int;
  v_left int;
  v_kept text;
begin
  -- 2건만 남긴다.
  v_deleted := public.prune_memories('00000000-0000-4000-8000-0000000000c1', 2);

  select count(*) into v_left
    from public.memories where soulmate_id = '00000000-0000-4000-8000-0000000000c1';

  if v_deleted <> 2 or v_left <> 2 then
    raise exception 'FAIL: 2건이 지워지고 2건이 남아야 하는데 지움=% 남음=%', v_deleted, v_left;
  end if;

  -- 중요도가 높은 것이 살아남아야 한다.
  select string_agg(content, ' / ' order by importance desc, created_at desc) into v_kept
    from public.memories where soulmate_id = '00000000-0000-4000-8000-0000000000c1';

  if v_kept not like '%새 팀장%' or v_kept not like '%팀 발표%' then
    raise exception 'FAIL: 중요한 기억이 지워졌습니다. 남은 것: %', v_kept;
  end if;

  -- 상한보다 적으면 아무것도 지우지 않아야 한다.
  v_deleted := public.prune_memories('00000000-0000-4000-8000-0000000000c1', 80);
  if v_deleted <> 0 then
    raise exception 'FAIL: 상한 미달인데 %건을 지웠습니다', v_deleted;
  end if;

  raise notice 'PASS: 중요도가 낮고 오래된 기억부터 정리되고, 상한 미달이면 건드리지 않습니다';
end;
$$;

\echo '--- 소울메이트 삭제 시 기억도 사라지는지 ---'
do $$
declare
  v_left int;
begin
  perform public.delete_soulmate(
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-0000000000c1'
  );

  select count(*) into v_left
    from public.memories where soulmate_id = '00000000-0000-4000-8000-0000000000c1';

  if v_left <> 0 then
    raise exception 'FAIL: 소울메이트를 지웠는데 기억이 %건 남았습니다', v_left;
  end if;

  raise notice 'PASS: 다시 만들기 하면 기억도 함께 초기화됩니다';
end;
$$;
