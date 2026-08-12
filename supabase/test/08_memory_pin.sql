-- 기억 고정 검증.
--
-- 고정의 약속은 두 가지다.
--   1. 자동 정리가 지우지 않는다
--   2. 회상할 때 맨 앞에 온다
-- 둘 다 깨지면 "고정해뒀는데 잊어버렸다"가 되고, 그게 이 기능의 유일한 실패 모드다.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-000000000007'''
\set sid '''00000000-0000-4000-8000-0000000000c2'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'pin@test.local', '{}'::jsonb);

select public.create_soulmate(
  :uid, :sid, '고정', 'friend',
  '{"name":"고정"}'::jsonb,
  '{"archetype":"calm","presentation":"feminine","vibe":"calm","presetId":"calm"}'::jsonb,
  null, null, '안녕!'
);

-- 고정한 것은 일부러 중요도를 제일 낮게, 제일 오래된 것으로 넣는다.
-- 정리 순서(중요도 desc, 최근 desc)만 보면 가장 먼저 지워질 자리다.
insert into public.memories (soulmate_id, kind, content, importance, pinned, created_at) values
  (:sid, 'fact',       '동생 이름이 지호다',      1, true,  now() - interval '9 day'),
  (:sid, 'event',      '금요일에 팀 발표가 있다', 3, false, now() - interval '3 day'),
  (:sid, 'concern',    '새 팀장과 부딪힌다',      3, false, now() - interval '1 day'),
  (:sid, 'preference', '매운 음식을 못 먹는다',   1, false, now());

\echo '--- 검증: 고정한 기억은 정리에서 살아남는다 ---'
do $$
declare
  v_deleted int;
  v_pinned int;
  v_unpinned int;
begin
  -- 고정하지 않은 것 3건 중 1건만 남긴다.
  v_deleted := public.prune_memories('00000000-0000-4000-8000-0000000000c2', 1);

  select count(*) filter (where pinned), count(*) filter (where not pinned)
    into v_pinned, v_unpinned
    from public.memories where soulmate_id = '00000000-0000-4000-8000-0000000000c2';

  -- p_keep 은 고정하지 않은 것에만 적용된다: 3건 중 1건 남고 2건 삭제.
  if v_deleted <> 2 then
    raise exception 'FAIL: 2건이 지워져야 하는데 %건 지웠습니다', v_deleted;
  end if;
  if v_unpinned <> 1 then
    raise exception 'FAIL: 고정 안 한 기억이 1건 남아야 하는데 %건입니다', v_unpinned;
  end if;
  if v_pinned <> 1 then
    raise exception 'FAIL: 고정한 기억이 지워졌습니다 (남은 고정 %건)', v_pinned;
  end if;

  raise notice 'PASS: 고정한 기억은 중요도가 가장 낮고 가장 오래됐어도 남습니다';
end;
$$;

\echo '--- 검증: 회상 순서에서 고정이 맨 앞 ---'
do $$
declare
  v_first text;
begin
  -- 남은 건 고정(중요도 1) 1건 + 미고정(중요도 3) 1건.
  -- 중요도만 보면 미고정이 앞이어야 하는데, 고정이 이겨야 한다.
  select content into v_first
    from public.memories
   where soulmate_id = '00000000-0000-4000-8000-0000000000c2'
   order by pinned desc, importance desc, created_at desc
   limit 1;

  if v_first <> '동생 이름이 지호다' then
    raise exception 'FAIL: 고정한 기억이 맨 앞이 아닙니다: %', v_first;
  end if;

  raise notice 'PASS: 고정한 기억이 중요도보다 앞섭니다';
end;
$$;

\echo '--- 검증: 전부 고정이면 정리가 아무것도 못 지운다 ---'
do $$
declare
  v_deleted int;
begin
  update public.memories set pinned = true
   where soulmate_id = '00000000-0000-4000-8000-0000000000c2';

  v_deleted := public.prune_memories('00000000-0000-4000-8000-0000000000c2', 1);
  if v_deleted <> 0 then
    raise exception 'FAIL: 전부 고정인데 %건을 지웠습니다', v_deleted;
  end if;

  raise notice 'PASS: 고정만 남았을 때 정리는 아무것도 하지 않습니다';
end;
$$;

\echo '--- 검증: 요약 워터마크 기본값 ---'
do $$
declare
  v_seq bigint;
begin
  select summarized_upto_seq into v_seq
    from public.conversations
   where soulmate_id = '00000000-0000-4000-8000-0000000000c2';

  -- 0이 아니면 첫 압축이 앞부분을 건너뛴다.
  if v_seq is distinct from 0 then
    raise exception 'FAIL: 새 대화의 워터마크가 0이 아닙니다: %', v_seq;
  end if;

  raise notice 'PASS: 새 대화는 워터마크 0에서 시작합니다';
end;
$$;
