-- 메시지 순서를 created_at 이 아니라 삽입 순서로 정한다.
--
-- 사용자 메시지와 응답을 한 번의 INSERT 로 넣는데,
-- Postgres 의 now() 는 트랜잭션 시작 시각이라 두 행의 created_at 이 완전히 같다.
-- 보조 정렬키로 쓰던 id 는 gen_random_uuid() 라 무작위여서,
-- 새로고침할 때마다 "질문 -> 답" 이 "답 -> 질문" 으로 뒤집혔다.
--
-- 시각을 1ms 씩 벌리는 방법도 있지만, 이후에 메시지를 넣는 코드가
-- 그 규칙을 계속 지켜야 해서 깨지기 쉽다. 순서 전용 열을 둔다.

alter table public.messages add column if not exists seq bigint;

-- 기존 행 채우기.
-- 같은 시각이면 사용자 메시지가 먼저다 — 항상 질문 다음에 응답을 저장했으므로
-- 이 규칙으로 원래 순서를 되살릴 수 있다.
with ordered as (
  select id,
         row_number() over (
           order by created_at,
                    case when role = 'user' then 0 else 1 end,
                    id
         ) as n
    from public.messages
)
update public.messages m
   set seq = o.n
  from ordered o
 where o.id = m.id
   and m.seq is null;

create sequence if not exists public.messages_seq_seq owned by public.messages.seq;

select setval(
  'public.messages_seq_seq',
  coalesce((select max(seq) from public.messages), 0) + 1,
  false
);

alter table public.messages alter column seq set default nextval('public.messages_seq_seq');
alter table public.messages alter column seq set not null;

-- 최근 N개 조회와 커서 페이지네이션이 모두 이 인덱스를 탄다.
create index if not exists messages_conversation_seq_idx
  on public.messages (conversation_id, seq desc);

-- created_at 기반 인덱스는 더 이상 정렬에 쓰지 않는다.
drop index if exists public.messages_conversation_recent_idx;
