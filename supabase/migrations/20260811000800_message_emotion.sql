-- 메시지의 감정을 저장한다.
--
-- 감정 태그는 표정 교체용으로만 쓰고 저장하지 않았다.
-- 그래서 대화창을 다시 열면 지난 메시지의 감정을 알 수 없어
-- 강조 색을 입힐 수 없었다(방금 온 것만 색이 있고 나머지는 무채색).
--
-- 새 markup 을 하나 더 만드는 대신 이미 있는 감정 태그를 쓴다.
-- 모델이 새 문법을 틀릴 여지가 없고, 색이 내용과 어긋나지도 않는다.
alter table public.messages add column if not exists emotion text;

comment on column public.messages.emotion is
  '응답 첫머리 태그에서 뽑은 감정. neutral/happy/worried/playful. 사용자 메시지는 null.';
