import type { AppearanceVibe, Presentation } from './persona';

/**
 * 프리셋 캐릭터.
 *
 * 무료 사용자는 여기서 골라 쓴다. 이미지가 이미 만들어져 있으므로
 * 온보딩에서 생성 실패가 없고 비용도 들지 않는다.
 * "AI로 만든 나만의 모습" 은 프리셋과 구분되는 유료 상품이 된다.
 *
 * ID 는 `{성별}_{분위기}` 다. 원본 이미지 파일명(`img/SoulMate/w_bright_normal.png`)과
 * 같은 규칙이라, 파일을 넣고 변환 스크립트를 돌리는 것 말고 옮겨 적을 일이 없다.
 *
 * 처음에는 ID 를 분위기(AppearanceVibe)와 같은 값으로 뒀지만, 성별 표현이 둘이 되면서
 * 그 규칙으로는 `bright` 가 두 캐릭터를 가리키게 된다. 그래서 분위기를 별도 필드로 뺐다.
 */
export const PRESET_CHARACTERS = [
  {
    id: 'w_bright',
    label: '산뜻한',
    description: '환하게 웃는 인상',
    vibe: 'bright',
    presentation: 'feminine',
  },
  {
    id: 'w_warm',
    label: '포근한',
    description: '부드럽고 따뜻한 인상',
    vibe: 'warm',
    presentation: 'feminine',
  },
  {
    id: 'w_calm',
    label: '단정한',
    description: '차분하고 지적인 인상',
    vibe: 'calm',
    presentation: 'feminine',
  },
  {
    id: 'w_chic',
    label: '시크한',
    description: '또렷하고 도시적인 인상',
    vibe: 'chic',
    presentation: 'feminine',
  },
  {
    id: 'm_bright',
    label: '산뜻한',
    description: '환하게 웃는 인상',
    vibe: 'bright',
    presentation: 'masculine',
  },
  {
    id: 'm_warm',
    label: '포근한',
    description: '부드럽고 따뜻한 인상',
    vibe: 'warm',
    presentation: 'masculine',
  },
  {
    id: 'm_calm',
    label: '단정한',
    description: '차분하고 지적인 인상',
    vibe: 'calm',
    presentation: 'masculine',
  },
  {
    id: 'm_chic',
    label: '시크한',
    description: '또렷하고 도시적인 인상',
    vibe: 'chic',
    presentation: 'masculine',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  description: string;
  /** 외형 분위기. AI 로 모습을 만들 때 프롬프트의 방향이 된다. */
  vibe: AppearanceVibe;
  /**
   * 이 캐릭터의 성별 표현.
   *
   * 온보딩에서 따로 묻지 않고 여기서 가져온다.
   * 프리셋 이미지가 이미 정해져 있는데 "남성적인/여성적인" 을 또 물으면
   * 고른 그림과 답이 어긋날 수 있다.
   */
  presentation: Presentation;
}[];

export type PresetId = (typeof PRESET_CHARACTERS)[number]['id'];

export const PRESET_IDS = PRESET_CHARACTERS.map((p) => p.id) as [PresetId, ...PresetId[]];

/** 성별 표현별로 묶은 목록. 선택 화면이 그룹으로 그려진다. */
export function presetsByPresentation(): {
  presentation: Presentation;
  characters: typeof PRESET_CHARACTERS;
}[] {
  const order: Presentation[] = ['feminine', 'masculine', 'neutral'];
  return order
    .map((presentation) => ({
      presentation,
      characters: PRESET_CHARACTERS.filter(
        (p) => p.presentation === presentation,
      ) as unknown as typeof PRESET_CHARACTERS,
    }))
    .filter((group) => group.characters.length > 0);
}

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

/**
 * 감정별 강조 색.
 *
 * 색을 따로 지시하지 않고 이미 있는 감정 태그에 묶는 이유:
 * 모델에 새 문법을 하나 더 가르치면 틀릴 여지가 생기고,
 * 색이 내용과 어긋난 채 출력될 수 있다. 감정에서 파생하면 그럴 수 없다.
 *
 * 실제 색값은 globals.css 의 CSS 변수로 두어 다크 모드에서 따로 조절한다.
 */
export const EMOTION_ACCENT_VAR: Record<Expression, string> = {
  neutral: 'var(--accent-neutral)',
  happy: 'var(--accent-happy)',
  worried: 'var(--accent-worried)',
  playful: 'var(--accent-playful)',
};

export function isExpression(value: unknown): value is Expression {
  return typeof value === 'string' && (EXPRESSIONS as readonly string[]).includes(value);
}

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
