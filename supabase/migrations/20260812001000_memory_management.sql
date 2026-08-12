-- 기억 관리.
--
-- 지금까지 기억은 모델이 넣고 상한이 밀어내기만 했다. 사용자는 볼 수도 지울 수도 없다.
-- 그래서 "발표 끝났어" 라고 말해도 "금요일에 발표가 있다" 가 그대로 남아 또 물어본다.
--
-- 고정(pinned)은 두 가지를 한다.
--  1. 회상할 때 맨 앞에 온다 — 사용자가 중요하다고 한 것이 먼저 들어간다.
--  2. 상한 정리에서 빠진다 — 남기라고 한 것을 자동 정리가 지우면 안 된다.

alter table public.memories
  add column if not exists pinned boolean not null default false;

-- 회상 순서가 바뀌었다(고정 -> 중요도 -> 최근). 인덱스도 같은 순서여야 한다.
drop index if exists public.memories_soulmate_recall_idx;
create index memories_soulmate_recall_idx
  on public.memories (soulmate_id, pinned desc, importance desc, created_at desc);

/**
 * 기억 상한 정리.
 *
 * 고정된 것은 세지도 지우지도 않는다. p_keep 은 "자동으로 쌓인 기억" 의 상한이고,
 * 고정한 기억은 그와 별개로 남는다. 고정 개수 자체는 API 에서 막는다
 * (프롬프트에 들어가는 자리가 정해져 있어서 — packages/shared MEMORY_PIN_LIMIT).
 *
 * 애플리케이션에서 조회 후 삭제하면 동시 요청에서 지울 대상이 어긋난다.
 * 한 문장으로 처리한다.
 */
create or replace function public.prune_memories(p_soulmate_id uuid, p_keep int)
returns int
language plpgsql
as $$
declare
  v_deleted int;
begin
  if p_keep <= 0 then
    raise exception 'keep must be positive' using errcode = '22023';
  end if;

  delete from public.memories
   where id in (
     select id
       from public.memories
      where soulmate_id = p_soulmate_id
        and not pinned
      order by importance desc, created_at desc
      offset p_keep
   );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
