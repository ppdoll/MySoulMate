-- 프리셋 ID 개명: bright -> w_bright.
--
-- 남성 캐릭터가 추가되면서 ID 규칙이 바뀌었다.
-- 예전에는 프리셋 ID 를 외형 분위기(bright/warm/calm/chic)와 같은 값으로 뒀는데,
-- 성별 표현이 둘이 되면 `bright` 가 두 캐릭터를 가리키게 된다.
-- 그래서 `{성별}_{분위기}` 로 바꿨다(packages/shared/src/presets.ts).
--
-- 이 마이그레이션이 없으면 기존 소울메이트를 못 불러온다.
-- AppearanceSchema 가 presetId 를 z.enum(PRESET_IDS) 로 검증하는데, 새 목록에는
-- 'calm' 이 없어서 GET /soulmate 가 파싱 단계에서 실패한다.
--
-- 기존 프리셋은 전부 여성 캐릭터였으므로 'w_' 를 붙이면 그대로 같은 그림을 가리킨다.
update public.soulmates
   set appearance = jsonb_set(
         appearance,
         '{presetId}',
         to_jsonb('w_' || (appearance ->> 'presetId'))
       ),
       updated_at = now()
 where appearance ->> 'presetId' in ('bright', 'warm', 'calm', 'chic');

-- 옮기지 못한 값이 남았는지 확인한다. 조용히 통과하면 배포 후에 500 으로 만난다.
do $$
declare
  v_stale int;
begin
  select count(*) into v_stale
    from public.soulmates
   where appearance ->> 'presetId' is not null
     and appearance ->> 'presetId' not like 'w\_%'
     and appearance ->> 'presetId' not like 'm\_%';

  if v_stale > 0 then
    raise exception '알 수 없는 presetId 가 %건 남았습니다. 수동 확인이 필요합니다.', v_stale;
  end if;
end;
$$;
