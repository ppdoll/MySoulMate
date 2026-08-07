import type { AppearanceVibe } from './persona';

/**
 * 온보딩의 첫 질문 — 소울메이트의 "큰 줄기".
 *
 * 성격 축을 빈 슬라이더로 먼저 물으면 고르기가 어렵다.
 * 완성된 예시 다섯 중 하나를 먼저 고르게 하고, 그 값에서 출발해 다듬는다.
 * 여기서 정해진 값은 이후 질문의 기본값으로 채워지며 사용자가 바꿀 수 있다.
 */
export const ARCHETYPES = [
  {
    value: 'sunlight',
    emoji: '🌤️',
    label: '햇살',
    tagline: '먼저 말 걸어주는 사람',
    description: '오늘 뭐 했냐고 먼저 묻고, 사소한 일에도 같이 신나 해요.',
    defaults: { energy: 5, thinking: 4, humor: 4, vibe: 'bright' },
    /** 이미지 프롬프트의 뼈대. 영어로 둔다 — 이미지 모델이 영어에 더 안정적이다. */
    visualDirection:
      'warm natural daylight, open friendly smile, relaxed casual clothing, soft airy background',
  },
  {
    value: 'calm',
    emoji: '🌿',
    label: '잔잔',
    tagline: '조용히 들어주는 사람',
    description: '재촉하지 않고 끝까지 들어준 다음, 딱 필요한 말만 건네요.',
    defaults: { energy: 2, thinking: 5, humor: 2, vibe: 'warm' },
    visualDirection:
      'soft diffused light, gentle calm expression, knit or linen textures, muted warm tones',
  },
  {
    value: 'steady',
    emoji: '📗',
    label: '든든',
    tagline: '생각을 정리해주는 사람',
    description: '엉킨 고민을 하나씩 풀어서 다음에 뭘 하면 될지 짚어줘요.',
    defaults: { energy: 3, thinking: 1, humor: 2, vibe: 'calm' },
    visualDirection:
      'clean even lighting, composed intelligent gaze, neat tailored clothing, minimal background',
  },
  {
    value: 'mischief',
    emoji: '🎈',
    label: '장난',
    tagline: '엉뚱하게 웃겨주는 사람',
    description: '진지한 얘기를 하다가도 한 번씩 김을 빼서 숨통을 틔워줘요.',
    defaults: { energy: 5, thinking: 3, humor: 5, vibe: 'bright' },
    visualDirection:
      'playful candid moment, bright mischievous eyes, colorful casual outfit, lively background',
  },
  {
    value: 'quiet',
    emoji: '🌙',
    label: '고요',
    tagline: '말수는 적지만 깊은 사람',
    description: '길게 말하지 않아도 옆에 있다는 게 느껴지는 쪽이에요.',
    defaults: { energy: 1, thinking: 4, humor: 1, vibe: 'chic' },
    visualDirection:
      'low key moody lighting, quiet thoughtful expression, monochrome clothing, deep shadowed background',
  },
] as const satisfies readonly {
  value: string;
  emoji: string;
  label: string;
  tagline: string;
  description: string;
  defaults: { energy: number; thinking: number; humor: number; vibe: AppearanceVibe };
  visualDirection: string;
}[];

export type ArchetypeValue = (typeof ARCHETYPES)[number]['value'];

export const ARCHETYPE_VALUES = ARCHETYPES.map((a) => a.value) as [
  ArchetypeValue,
  ...ArchetypeValue[],
];

export function getArchetype(value: ArchetypeValue) {
  // 값이 리터럴 유니온이므로 항상 찾아진다.
  return ARCHETYPES.find((a) => a.value === value)!;
}
