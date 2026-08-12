-- 사용자 소개.
--
-- 지금까지 캐릭터가 상대에 대해 아는 건 구글 이름 하나뿐이었다.
-- 나머지는 대화로 하나씩 알아내야 하고, 40턴이 지나 기억으로 굳기 전까지는 매번 잊는다.
-- 사용자가 직접 적어두면 첫 대화부터 그걸 알고 시작한다.
alter table public.profiles add column if not exists self_intro text;

comment on column public.profiles.self_intro is
  '사용자가 직접 적은 자기 소개. 매 턴 시스템 프롬프트에 들어가므로 애플리케이션에서 길이를 제한한다.';
