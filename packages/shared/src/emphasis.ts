/**
 * 강조 표기 파싱.
 *
 * 두 가지만 받는다.
 *   `**정말**`     -> 굵게. 힘주어 말하는 짧은 부분.
 *   `*고개를 끄덕*` -> 기울임. 말이 아니라 동작이나 상황 묘사.
 *
 * 마크다운 전체를 받지 않는 이유: 제목이나 목록이 말풍선에 들어오면 대화가 문서처럼 보인다.
 *
 * HTML을 만들지 않고 토큰을 돌려준다. 화면에서 React 노드로 그리므로
 * 모델이 무엇을 출력하든 주입이 일어날 수 없다.
 */

export interface EmphasisToken {
  text: string;
  bold: boolean;
  /** 동작·상황 묘사. 대사와 구분되게 흐리고 기울여 그린다. */
  italic: boolean;
}

export function parseEmphasis(text: string): EmphasisToken[] {
  if (!text) return [];

  const tokens: EmphasisToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    const open = rest.indexOf('*');
    if (open === -1) {
      tokens.push(plain(rest));
      break;
    }

    const bold = rest.startsWith('**', open);
    const marker = bold ? '**' : '*';
    const body = rest.slice(open + marker.length);

    // 여는 마커까지만 도착한 상태(스트리밍 중). 마커가 잠깐 보이지 않게 버린다.
    if (body.length === 0) {
      if (open > 0) tokens.push(plain(rest.slice(0, open)));
      break;
    }

    // 마커 뒤가 공백이면 강조가 아니다. `* 항목` 같은 목록 표시를 강조로 잡으면
    // 뒤 문장 전체가 기울어진다.
    if (/\s/.test(body[0]!)) {
      tokens.push(plain(rest.slice(0, open + marker.length)));
      rest = body;
      continue;
    }

    if (open > 0) tokens.push(plain(rest.slice(0, open)));

    const close = body.indexOf(marker);
    if (close === -1) {
      // 줄바꿈을 넘어가면 강조가 아니다. 묘사도 강조도 한 줄 안에서 끝난다.
      // `3*4` 같은 별표 하나 때문에 남은 문단 전체가 기울어지는 걸 막는다.
      if (body.includes('\n')) {
        tokens.push(plain(marker));
        rest = body;
        continue;
      }

      // 아직 닫히지 않았다. 지금까지 온 만큼을 이미 강조된 상태로 보여준다.
      // 마커를 그대로 두면 별표가 보이고, 통째로 숨기면 문장이 뒤늦게 튀어나온다.
      //
      // `**좀*` 처럼 닫는 마커가 절반만 온 순간이 있다. 남은 별표를 떼지 않으면
      // 그 한 글자가 굵은 글씨 끝에 잠깐 보인다.
      const shown = bold && body.endsWith('*') ? body.slice(0, -1) : body;
      if (shown) tokens.push({ text: shown, bold, italic: !bold });
      break;
    }

    const inner = body.slice(0, close);
    // `****` 처럼 빈 강조는 버린다.
    if (inner) tokens.push({ text: inner, bold, italic: !bold });

    rest = body.slice(close + marker.length);
  }

  return tokens.filter((t) => t.text.length > 0);
}

/** 강조 마커를 떼어낸 순수 텍스트. 길이 계산이나 미리보기에 쓴다. */
export function stripEmphasis(text: string): string {
  return parseEmphasis(text)
    .map((t) => t.text)
    .join('');
}

function plain(text: string): EmphasisToken {
  return { text, bold: false, italic: false };
}
