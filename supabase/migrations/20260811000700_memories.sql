-- 장기 기억 활용.
--
-- memories 테이블은 M1에서 만들어뒀고 여기서 처음 쓴다.
-- 요약이 흐름을 뭉개서 남기는 반면, 기억은 "금요일에 팀 발표가 있다" 처럼
-- 구체적인 사실을 그대로 남긴다. 다시 만났을 때 먼저 물어보게 하는 게 목적이다.

-- 회상 조회는 중요도 -> 최근 순이다. 기존 인덱스는 created_at 만 다룬다.
create index if not exists memories_soulmate_recall_idx
  on public.memories (soulmate_id, importance desc, created_at desc);

/**
 * 기억 상한 정리.
 *
 * 지난 일("발표가 있다" -> 이미 끝남)이 계속 쌓이면 프롬프트가 낡은 사실로 채워진다.
 * 지금은 중요도가 낮고 오래된 것부터 밀어내는 방식으로만 처리한다.
 * (끝난 일을 알아보고 지우는 건 다음 단계)
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
      order by importance desc, created_at desc
      offset p_keep
   );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
