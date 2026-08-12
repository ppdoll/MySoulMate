-- 되돌려진 응답 기록.
--
-- 되돌리기와 다시 답하기는 그 자체로 "이 응답은 실패했다" 는 신호다.
-- 유저가 직접, 매번, 공짜로 라벨을 달아주는 셈이다. 이걸 버리면 프롬프트를
-- 고칠 때 감으로 고치게 된다.
--
-- 내용을 통째로 남기는 이유: messages 행은 되돌리는 순간 사라진다.
-- 여기 남기지 않으면 "몇 건 되돌려졌다" 는 숫자만 남고 왜 그랬는지는 알 수 없다.
--
-- 다만 사용자는 "지웠다" 고 생각한다. 그래서
--   - 소울메이트를 지우면(다시 만들기 포함) 함께 사라진다
--   - 개인정보처리방침(M7)에 이 보관을 반드시 적는다
create table public.rejected_messages (
  id uuid primary key default gen_random_uuid(),
  soulmate_id uuid not null references public.soulmates (id) on delete cascade,
  -- 'undo'(그냥 지움) | 'regenerate'(다시 답하게 함)
  -- 다시 답하기가 더 강한 불만이다 -- 크레딧을 더 내고서라도 바꾸고 싶었다는 뜻이라서.
  action text not null check (action in ('undo', 'regenerate')),
  -- 이 응답을 부른 사용자의 말. 이게 없으면 응답만 보고는 뭐가 잘못됐는지 모른다.
  user_text text not null,
  answer text not null,
  emotion text,
  created_at timestamptz not null default now()
);

-- 운영자는 항상 "최근에 뭐가 깨졌나" 를 본다.
create index rejected_messages_recent_idx
  on public.rejected_messages (created_at desc);

alter table public.rejected_messages enable row level security;
revoke all on public.rejected_messages from anon, authenticated;
