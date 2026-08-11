import type { AppearanceVibe, Presentation } from './persona';

/**
 * 프리셋 캐릭터.
 *
 * 무료 사용자는 여기서 골라 쓴다. 이미지가 이미 만들어져 있으므로
 * 온보딩에서 생성 실패가 없고 비용도 들지 않는다.
 * "AI로 만든 나만의 모습" 은 프리셋과 구분되는 유료 상품이 된다.
 *
 * ID를 외형 분위기(AppearanceVibe)와 같은 값으로 맞춘 이유:
 * 온보딩에서 고른 타입이 이미 분위기를 정하므로, 그에 맞는 프리셋을
 * 기본 선택으로 띄울 수 있다. 새 분류를 만들 필요가 없다.
 */
export const PRESET_CHARACTERS = [
  {
    id: 'bright',
    label: '산뜻한',
    description: '환하게 웃는 인상',
    presentation: 'feminine',
  },
  {
    id: 'warm',
    label: '포근한',
    description: '부드럽고 따뜻한 인상',
    presentation: 'feminine',
  },
  {
    id: 'calm',
    label: '단정한',
    description: '차분하고 지적인 인상',
    presentation: 'feminine',
  },
  {
    id: 'chic',
    label: '시크한',
    description: '또렷하고 도시적인 인상',
    presentation: 'feminine',
  },
] as const satisfies readonly {
  id: AppearanceVibe;
  label: string;
  description: string;
  /**
   * 이 캐릭터의 성별 표현.
   *
   * 온보딩에서 따로 묻지 않고 여기서 가져온다.
   * 프리셋 이미지가 이미 정해져 있는데 "남성적인/여성적인" 을 또 물으면
   * 고른 그림과 답이 어긋날 수 있다.
   * 남성 캐릭터를 추가하면 여기만 바꾸면 된다.
   */
  presentation: Presentation;
}[];

export type PresetId = (typeof PRESET_CHARACTERS)[number]['id'];

export const PRESET_IDS = PRESET_CHARACTERS.map((p) => p.id) as [PresetId, ...PresetId[]];

/**
 * 표정. 대화 중 감정에 따라 교체된다.
 *
 * 늘리려면 여기에 추가하고 이미지 파일만 더 넣으면 된다.
 * 파일이 없으면 neutral로 떨어지므로 중간 상태에서도 깨지지 않는다.
 */
export const EXPRESSIONS = ['neutral', 'happy', 'worried', 'playful'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** 모델이 응답 첫머리에 붙이는 태그 → 표정. */
export const EMOTION_TAGS: Record<string, Expression> = {
  기본: 'neutral',
  기쁨: 'happy',
  걱정: 'worried',
  장난: 'playful',
};

export const EMOTION_TAG_NAMES = Object.keys(EMOTION_TAGS);

/** 정적 자원 경로. Vercel CDN이 서빙하므로 런타임 비용이 없다. */
export function presetImagePath(id: PresetId, expression: Expression): string {
  return `/presets/${id}/${expression}.webp`;
}

export function getPreset(id: PresetId) {
  // id가 리터럴 유니온이므로 항상 찾아진다.
  return PRESET_CHARACTERS.find((p) => p.id === id)!;
}

/**
 * 응답 첫머리의 `[기쁨]` 같은 태그를 떼어낸다.
 *
 * 스트리밍 첫 조각에 태그가 실려 오므로, 글자가 다 나오기 전에 표정을 바꿀 수 있다.
 * 모델이 태그를 빠뜨리면 neutral로 두고 본문은 그대로 쓴다 — 태그 강제 때문에
 * 대화가 실패하면 안 된다.
 */
export function parseEmotionTag(text: string): { expression: Expression; rest: string } {
  const match = /^\s*\[([^\]]{1,10})\]\s*/.exec(text);
  if (!match) return { expression: 'neutral', rest: text };

  const expression = EMOTION_TAGS[match[1]!.trim()];
  if (!expression) return { expression: 'neutral', rest: text };

  return { expression, rest: text.slice(match[0].length) };
}
