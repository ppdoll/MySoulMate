/**
 * 강조 표기 파싱.
 *
 * 모델이 `**정말**` 처럼 감싼 부분을 굵게 보여준다.
 * 마크다운 전체를 받지 않는 이유: 제목이나 목록이 말풍선에 들어오면 대화가 문서처럼 보인다.
 * 굵게 하나만 허용한다.
 *
 * HTML을 만들지 않고 토큰을 돌려준다. 화면에서 React 노드로 그리므로
 * 모델이 무엇을 출력하든 주입이 일어날 수 없다.
 */

export interface EmphasisToken {
  text: string;
  bold: boolean;
}

const MARKER = '**';

export function parseEmphasis(text: string): EmphasisToken[] {
  if (!text) return [];

  const tokens: EmphasisToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    const open = rest.indexOf(MARKER);
    if (open === -1) {
      tokens.push({ text: rest, bold: false });
      break;
    }

    const close = rest.indexOf(MARKER, open + MARKER.length);

    // 닫히지 않은 마커. 스트리밍 중에 흔히 생긴다.
    // 그대로 두면 `**` 가 잠깐 보이므로 앞부분만 내보내고 마커는 버린다.
    // 닫는 마커가 도착하면 다음 렌더에서 굵게 바뀐다.
    if (close === -1) {
      if (open > 0) tokens.push({ text: rest.slice(0, open), bold: false });
      break;
    }

    const inner = rest.slice(open + MARKER.length, close);

    if (open > 0) tokens.push({ text: rest.slice(0, open), bold: false });
    // `****` 처럼 빈 강조는 버린다.
    if (inner) tokens.push({ text: inner, bold: true });

    rest = rest.slice(close + MARKER.length);
  }

  return tokens.filter((t) => t.text.length > 0);
}

/** 강조 마커를 떼어낸 순수 텍스트. 길이 계산이나 미리보기에 쓴다. */
export function stripEmphasis(text: string): string {
  return parseEmphasis(text)
    .map((t) => t.text)
    .join('');
}
