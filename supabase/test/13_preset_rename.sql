-- 프리셋 ID 개명 검증.
--
-- 마이그레이션 자체는 빈 DB에 적용되므로 아무 행도 만나지 않는다.
-- 그래서 옛 형태의 행을 만들어놓고 같은 변환을 다시 돌려, 실제 DB에서 무슨 일이
-- 일어나는지 확인한다.
--
-- 이걸 확인하는 이유: 옮기지 못한 presetId 가 하나라도 남으면 그 계정은
-- GET /soulmate 에서 500 을 받는다(AppearanceSchema 가 z.enum 으로 검증한다).
-- 배포 후에 발견하면 그 사용자는 서비스에 들어올 수 없다.
\set ON_ERROR_STOP on

\set uid '''00000000-0000-4000-8000-00000000002a'''
\set sid '''00000000-0000-4000-8000-0000000000f1'''

insert into auth.users (id, email, raw_user_meta_data)
values (:uid, 'rename@test.local', '{}'::jsonb);

select public.create_soulmate(
  :uid, :sid, '옛프리셋', 'friend',
  '{"name":"옛프리셋"}'::jsonb,
  -- 개명 전 형태: presetId 가 분위기와 같은 값이다.
  '{"archetype":"calm","presentation":"feminine","vibe":"chic","presetId":"chic"}'::jsonb,
  null, null, '안녕!'
);

\echo '--- 검증: 옛 presetId 가 w_ 접두어로 옮겨진다 ---'
do $$
declare
  v_preset text;
  v_vibe text;
  v_archetype text;
begin
  -- 마이그레이션 20260813001600 과 같은 문장.
  update public.soulmates
     set appearance = jsonb_set(
           appearance,
           '{presetId}',
           to_jsonb('w_' || (appearance ->> 'presetId'))
         )
   where appearance ->> 'presetId' in ('bright', 'warm', 'calm', 'chic');

  select appearance ->> 'presetId', appearance ->> 'vibe', appearance ->> 'archetype'
    into v_preset, v_vibe, v_archetype
    from public.soulmates where id = '00000000-0000-4000-8000-0000000000f1';

  if v_preset <> 'w_chic' then
    raise exception 'FAIL: presetId 가 %입니다 (w_chic 이어야 함)', v_preset;
  end if;

  -- 분위기와 타입은 건드리지 않아야 한다. jsonb_set 이 다른 키를 지우면 여기서 걸린다.
  if v_vibe <> 'chic' then
    raise exception 'FAIL: vibe 가 %로 바뀌었습니다', v_vibe;
  end if;
  -- archetype 이 'calm' 인 건 일부러다 — 분위기 이름과 겹치는 값이 있어도
  -- presetId 만 골라 바꿔야 한다.
  if v_archetype <> 'calm' then
    raise exception 'FAIL: archetype 이 %로 바뀌었습니다', v_archetype;
  end if;

  raise notice 'PASS: presetId 만 w_ 로 옮겨지고 vibe/archetype 은 그대로입니다';
end;
$$;

\echo '--- 검증: 두 번 돌려도 두 번 붙지 않는다 ---'
do $$
declare
  v_preset text;
begin
  -- 마이그레이션을 다시 적용하는 상황(수동 재실행)에서 w_w_chic 이 되면 안 된다.
  update public.soulmates
     set appearance = jsonb_set(
           appearance,
           '{presetId}',
           to_jsonb('w_' || (appearance ->> 'presetId'))
         )
   where appearance ->> 'presetId' in ('bright', 'warm', 'calm', 'chic');

  select appearance ->> 'presetId' into v_preset
    from public.soulmates where id = '00000000-0000-4000-8000-0000000000f1';

  if v_preset <> 'w_chic' then
    raise exception 'FAIL: 재실행 후 presetId 가 %입니다', v_preset;
  end if;

  raise notice 'PASS: 이미 옮겨진 값은 다시 건드리지 않습니다';
end;
$$;

\echo '--- 검증: 알 수 없는 presetId 는 남는다(감지되어야 함) ---'
do $$
declare
  v_stale int;
begin
  -- 마이그레이션 안의 확인 블록이 이런 값을 잡아낸다.
  update public.soulmates
     set appearance = jsonb_set(appearance, '{presetId}', to_jsonb('unknown_x'::text))
   where id = '00000000-0000-4000-8000-0000000000f1';

  select count(*) into v_stale
    from public.soulmates
   where appearance ->> 'presetId' is not null
     and appearance ->> 'presetId' not like 'w\_%'
     and appearance ->> 'presetId' not like 'm\_%';

  if v_stale <> 1 then
    raise exception 'FAIL: 이상한 presetId 를 감지하지 못했습니다 (%건)', v_stale;
  end if;

  -- 테스트 뒤로 다른 검증에 영향을 주지 않게 되돌린다.
  update public.soulmates
     set appearance = jsonb_set(appearance, '{presetId}', to_jsonb('w_chic'::text))
   where id = '00000000-0000-4000-8000-0000000000f1';

  raise notice 'PASS: 옮기지 못한 값이 있으면 마이그레이션이 멈춥니다';
end;
$$;
