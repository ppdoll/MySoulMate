/**
 * 캐릭터 화풍.
 *
 * 프리셋 캐릭터(사람이 직접 생성)와 AI 아바타(런타임 생성)가 같은 화풍이어야 한다.
 * 유료로 "나만의 모습" 을 만든 순간 화풍이 달라지면 같은 서비스로 보이지 않는다.
 *
 * 그래서 문자열을 여기 한 곳에만 둔다.
 * apps/web/public/presets/README.md 의 안내문도 이 값을 그대로 옮겨 적은 것이다.
 */
export const ART_STYLE_PROMPT = [
  'Soft Korean webtoon illustration style.',
  'Clean confident line art, gentle cel shading with soft gradients,',
  'warm muted color palette, delicate expressive facial features.',
  'Not photorealistic, not 3D render.',
  'No text, no watermark, no signature.',
].join(' ');

/** 모든 인물 이미지에 공통으로 붙는 구도·안전 조건. */
export const FIGURE_COMPOSITION_PROMPT = [
  'Square 1:1 composition, upper-body, facing the viewer,',
  'head in the upper third of the frame.',
  'An adult, tasteful and fully clothed.',
].join(' ');
