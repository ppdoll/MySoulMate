import { z } from 'zod';

/**
 * 소울메이트의 페르소나 정의.
 *
 * 이 스키마는 두 곳에서 쓰인다:
 *  1. LLM이 온보딩 답변을 읽고 채워야 하는 structured output 형식
 *  2. DB soulmates.persona 컬럼의 형태
 *
 * 자유 텍스트로 페르소나를 받으면 시스템 프롬프트가 매번 흔들려서
 * 같은 캐릭터인데 대화마다 말투가 달라진다. 그래서 스키마를 강제한다.
 */

/** 관계 톤. 사용자가 온보딩에서 직접 고른다. */
export const RELATIONSHIP_TONES = ['friend', 'mentor', 'partner'] as const;
export type RelationshipTone = (typeof RELATIONSHIP_TONES)[number];

export const RELATIONSHIP_TONE_META: Record<
  RelationshipTone,
  { label: string; description: string }
> = {
  friend: {
    label: '친구',
    description: '편하게 수다 떨고 시시콜콜한 얘기를 나누는 사이',
  },
  mentor: {
    label: '멘토',
    description: '고민을 정리해주고 방향을 같이 찾아주는 사이',
  },
  partner: {
    label: '연인',
    description: '애틋하게 챙겨주고 하루를 함께 나누는 사이',
  },
};

/** 말투. 반말/존댓말. */
export const SPEECH_STYLES = ['casual', 'polite'] as const;
export type SpeechStyle = (typeof SPEECH_STYLES)[number];

export const SPEECH_STYLE_META: Record<SpeechStyle, { label: string; description: string }> = {
  casual: { label: '반말', description: '"오늘 어땠어?" 처럼 가깝고 편한 말투' },
  polite: { label: '존댓말', description: '"오늘 어떠셨어요?" 처럼 다정하고 정중한 말투' },
};

/** 외형의 성별 표현. 이미지 프롬프트 생성에 쓰인다. */
export const PRESENTATIONS = ['feminine', 'masculine', 'neutral'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export const PRESENTATION_META: Record<Presentation, { label: string }> = {
  feminine: { label: '여성적인' },
  masculine: { label: '남성적인' },
  neutral: { label: '중성적인' },
};

/** 외형 분위기 프리셋. */
export const APPEARANCE_VIBES = ['bright', 'calm', 'warm', 'chic'] as const;
export type AppearanceVibe = (typeof APPEARANCE_VIBES)[number];

export const APPEARANCE_VIBE_META: Record<AppearanceVibe, { label: string; description: string }> =
  {
    bright: { label: '밝고 산뜻한', description: '환한 표정, 가벼운 색감' },
    calm: { label: '차분하고 지적인', description: '단정한 인상, 절제된 색감' },
    warm: { label: '따뜻하고 포근한', description: '부드러운 눈매, 니트 같은 질감' },
    chic: { label: '시크하고 도시적인', description: '또렷한 인상, 모노톤' },
  };

/**
 * LLM이 생성하는 페르소나.
 *
 * 길이 상한을 두는 이유: 이 내용이 매 요청마다 시스템 프롬프트로 들어가기 때문에
 * 제한이 없으면 토큰이 계속 불어나 무료 티어 한도를 빨리 태운다.
 */
export const PersonaSchema = z.object({
  /** 소울메이트의 이름. 사용자가 정한 이름을 그대로 쓰거나 다듬는다. */
  name: z.string().min(1).max(20),
  /** 한 줄 소개. 카드 UI에 표시된다. */
  oneLiner: z.string().min(1).max(80),
  /** 성격 키워드. UI에 태그로 노출된다. */
  traits: z.array(z.string().min(1).max(20)).min(3).max(6),
  speechStyle: z.enum(SPEECH_STYLES),
  /** 말투 예시 문장. 시스템 프롬프트에서 few-shot 역할을 한다. */
  speechSamples: z.array(z.string().min(1).max(120)).min(2).max(4),
  /** 짧은 배경 설정. 대화에 일관성을 준다. */
  backstory: z.string().min(1).max(600),
  interests: z.array(z.string().min(1).max(24)).min(2).max(6),
  /** 첫 인사말. 온보딩 직후 대화창에 미리 꽂아둔다. */
  greeting: z.string().min(1).max(200),
  /**
   * 이미지 모델에 넘길 외형 프롬프트. 영어로 생성한다.
   * 재생성할 때도 이 프롬프트를 기준선으로 삼는다.
   */
  appearancePrompt: z.string().min(1).max(600),
});

export type Persona = z.infer<typeof PersonaSchema>;

/** DB soulmates.appearance 컬럼. 온보딩에서 고른 외형 입력을 원본 그대로 보관한다. */
export const AppearanceSchema = z.object({
  presentation: z.enum(PRESENTATIONS),
  vibe: z.enum(APPEARANCE_VIBES),
  note: z.string().max(200).optional(),
});

export type Appearance = z.infer<typeof AppearanceSchema>;
