/**
 * 응답을 말풍선 여러 개로 나눈다.
 *
 * 사람은 메신저에서 긴 말을 한 덩어리로 보내지 않는다. 두세 개로 끊어 보낸다.
 * 한 덩어리로 띄우면 읽기도 부담스럽고 '문서' 처럼 느껴진다.
 *
 * 왼쪽에서 오른쪽으로 한 번만 훑는 방식이라, 뒤에 글자가 더 붙어도
 * 앞쪽 분할 결과는 바뀌지 않는다. 스트리밍 도중 매 조각마다 다시 호출해도
 * 이미 뜬 말풍선이 재배치되지 않는다는 뜻이다.
 * 그래서 실시간 스트리밍과 나중에 기록을 다시 그릴 때 결과가 항상 같다.
 */

/** 이보다 짧으면 끊지 않는다. 너무 잘게 쪼개면 그것대로 산만하다. */
const MIN_SEGMENT = 25;

/** 말풍선 최대 개수. 넘으면 나머지를 마지막 풍선에 몰아넣는다. */
const MAX_BUBBLES = 3;

/** 문장 끝으로 볼 문자. */
const SENTENCE_END = /[.!?~…]/;

export function splitIntoBubbles(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const segments: string[] = [];
  let current = '';

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    current += ch;

    // 마지막 풍선에는 남은 걸 전부 담는다.
    if (segments.length >= MAX_BUBBLES - 1) continue;

    const next = trimmed[i + 1];

    // 줄바꿈은 문장 부호가 없어도 확실한 경계다.
    if (ch === '\n') {
      if (current.trim().length >= MIN_SEGMENT) {
        segments.push(current.trim());
        current = '';
      }
      continue;
    }

    if (!SENTENCE_END.test(ch)) continue;
    // "..." 처럼 이어지는 부호 중간에서는 끊지 않는다.
    if (next && SENTENCE_END.test(next)) continue;
    // 문장이 끝났는데 뒤에 아무것도 없으면 굳이 끊을 필요가 없다.
    if (!next) continue;
    // 공백이 따라오지 않으면 문장 끝이 아닐 수 있다(예: 3.5, ㅋㅋ?)
    if (!/\s/.test(next)) continue;

    if (current.trim().length >= MIN_SEGMENT) {
      segments.push(current.trim());
      current = '';
    }
  }

  const rest = current.trim();
  if (rest) segments.push(rest);

  return segments.length > 0 ? segments : [trimmed];
}
