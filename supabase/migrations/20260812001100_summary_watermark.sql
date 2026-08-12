-- 요약 진행 위치.
--
-- 버그 수정이다. maybeCompress 는 "메시지가 40개를 넘으면 오래된 20개를 압축한다"
-- 인데, 어디까지 압축했는지를 아무도 기록하지 않았다. 그래서 40개를 넘긴 뒤로는
-- 매 턴 같은 앞 20개를 다시 요약했다.
--   - 턴마다 압축 호출이 한 번씩 더 나간다(계속, 영원히)
--   - 같은 기억이 반복해서 추출돼 목록을 채우고, 정리가 진짜 최신 기억을 밀어낸다
--
-- summarized_upto_message_id 가 이 목적으로 있었지만 한 번도 쓰이지 않았다.
-- 정렬 기준이 seq 로 바뀌었으므로(20260811000600) 워터마크도 seq 로 둔다.
-- id 로 두면 매번 seq 를 다시 조회해야 한다.

alter table public.conversations
  drop column if exists summarized_upto_message_id;

alter table public.conversations
  add column if not exists summarized_upto_seq bigint not null default 0;
