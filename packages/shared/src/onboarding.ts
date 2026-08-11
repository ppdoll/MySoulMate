import { z } from 'zod';
import {
  APPEARANCE_VIBES,
  PRESENTATIONS,
  PRESENTATION_META,
  RELATIONSHIP_TONES,
  RELATIONSHIP_TONE_META,
  SPEECH_STYLES,
  SPEECH_STYLE_META,
} from './persona';
import { ARCHETYPES, ARCHETYPE_VALUES, getArchetype, type ArchetypeValue } from './archetypes';
import { PRESET_IDS } from './presets';

/**
 * 온보딩 질문 정의.
 *
 * web은 이걸 읽어서 화면을 그리고, api는 같은 정의로 답변을 검증하고 LLM 프롬프트를 만든다.
 * 질문을 추가할 때는 아래 OnboardingAnswersSchema도 같이 고쳐야 하며,
 * 파일 맨 아래 컴파일 타임 검사가 둘이 어긋나는 걸 잡아준다.
 *
 * 첫 질문(archetype)이 성격 3축과 외형 분위기의 기본값을 채운다.
 * 이후 질문은 그 값에서 출발해 다듬는 용도다 — 빈 슬라이더부터 시작하면 고르기가 어렵다.
 */

export interface OnboardingOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

interface QuestionBase {
  readonly key: string;
  readonly title: string;
  readonly help?: string;
}

export type OnboardingQuestion =
  | (QuestionBase & {
      readonly type: 'text';
      readonly placeholder: string;
      readonly maxLength: number;
      readonly optional?: boolean;
    })
  | (QuestionBase & { readonly type: 'single'; readonly options: readonly OnboardingOption[] })
  | (QuestionBase & {
      readonly type: 'multi';
      readonly options: readonly OnboardingOption[];
      readonly min: number;
      readonly max: number;
    })
  | (QuestionBase & {
      readonly type: 'scale';
      readonly minLabel: string;
      readonly maxLabel: string;
    })
  /** 큰 줄기를 고르는 카드형 질문. 화면에서 다른 단일 선택과 다르게 그려진다. */
  | (QuestionBase & { readonly type: 'archetype' })
  /** 프리셋 캐릭터 고르기. 이미지 격자로 그린다. */
  | (QuestionBase & { readonly type: 'preset' });

/** 관심사 선택지. 페르소나의 대화 소재가 된다. */
export const INTEREST_OPTIONS = [
  { value: 'daily', label: '일상 수다' },
  { value: 'movie', label: '영화·드라마' },
  { value: 'music', label: '음악' },
  { value: 'book', label: '책' },
  { value: 'game', label: '게임' },
  { value: 'workout', label: '운동' },
  { value: 'travel', label: '여행' },
  { value: 'cooking', label: '요리' },
  { value: 'pet', label: '반려동물' },
  { value: 'career', label: '일·커리어' },
  { value: 'study', label: '공부' },
  { value: 'art', label: '그림·예술' },
] as const satisfies readonly OnboardingOption[];

export type InterestValue = (typeof INTEREST_OPTIONS)[number]['value'];

const toneOptions = RELATIONSHIP_TONES.map((value) => ({
  value,
  label: RELATIONSHIP_TONE_META[value].label,
  description: RELATIONSHIP_TONE_META[value].description,
}));

const speechOptions = SPEECH_STYLES.map((value) => ({
  value,
  label: SPEECH_STYLE_META[value].label,
  description: SPEECH_STYLE_META[value].description,
}));

const presentationOptions = PRESENTATIONS.map((value) => ({
  value,
  label: PRESENTATION_META[value].label,
}));

export const ONBOARDING_QUESTIONS = [
  {
    key: 'archetype',
    type: 'archetype',
    title: '어떤 사람이었으면 좋겠어요?',
    help: '가장 가까운 쪽을 고르세요. 다음 단계에서 세부를 다듬을 수 있어요.',
  },
  {
    key: 'callName',
    type: 'text',
    title: '어떤 이름으로 부를까요?',
    help: '나중에 바꿀 수 있어요.',
    placeholder: '예: 하린',
    maxLength: 20,
  },
  {
    key: 'tone',
    type: 'single',
    title: '어떤 사이였으면 좋겠어요?',
    options: toneOptions,
  },
  {
    key: 'speechStyle',
    type: 'single',
    title: '말투는 어떤 쪽이 좋아요?',
    options: speechOptions,
  },
  {
    key: 'energy',
    type: 'scale',
    title: '성격의 에너지는 어느 쪽인가요?',
    minLabel: '차분한',
    maxLabel: '활발한',
  },
  {
    key: 'thinking',
    type: 'scale',
    title: '고민을 얘기했을 때 어떻게 반응해주면 좋아요?',
    minLabel: '논리적으로 정리',
    maxLabel: '먼저 공감',
  },
  {
    key: 'humor',
    type: 'scale',
    title: '대화 분위기는요?',
    minLabel: '진지한',
    maxLabel: '장난스러운',
  },
  {
    key: 'interests',
    type: 'multi',
    title: '어떤 얘기를 자주 나누고 싶어요?',
    help: '1~3개 골라주세요.',
    options: INTEREST_OPTIONS,
    min: 1,
    max: 3,
  },
  {
    key: 'presentation',
    type: 'single',
    title: '외모는 어떤 인상이 좋을까요?',
    options: presentationOptions,
  },
  {
    key: 'presetId',
    type: 'preset',
    title: '어떤 모습이 좋아요?',
    help: '나중에 나만의 모습을 따로 만들 수도 있어요.',
  },
] as const satisfies readonly OnboardingQuestion[];

export type OnboardingQuestionKey = (typeof ONBOARDING_QUESTIONS)[number]['key'];

/**
 * 화면에서 순회할 때 쓰는 목록.
 *
 * ONBOARDING_QUESTIONS는 `as const`라 각 항목이 리터럴 타입으로 남는다.
 * 그대로 순회하면 `help`처럼 일부 항목에만 있는 필드에 접근할 수 없다.
 * 키 추출에는 위쪽 리터럴 타입이 필요하므로 둘을 나눠서 내보낸다.
 */
export const ONBOARDING_QUESTION_LIST: readonly OnboardingQuestion[] = ONBOARDING_QUESTIONS;

/** 1~5 척도. 3이 중간. */
const scale = z.number().int().min(1).max(5);

export const OnboardingAnswersSchema = z.object({
  archetype: z.enum(ARCHETYPE_VALUES),
  callName: z.string().trim().min(1).max(20),
  tone: z.enum(RELATIONSHIP_TONES),
  speechStyle: z.enum(SPEECH_STYLES),
  energy: scale,
  thinking: scale,
  humor: scale,
  interests: z
    .array(z.enum(INTEREST_OPTIONS.map((o) => o.value) as [InterestValue, ...InterestValue[]]))
    .min(1)
    .max(3),
  presentation: z.enum(PRESENTATIONS),
  presetId: z.enum(PRESET_IDS),
});

export type OnboardingAnswers = z.infer<typeof OnboardingAnswersSchema>;

/** 타입을 고른 직후 나머지 답변에 채워 넣을 기본값. */
export function defaultsForArchetype(value: ArchetypeValue) {
  const { defaults } = getArchetype(value);
  return {
    energy: defaults.energy,
    thinking: defaults.thinking,
    humor: defaults.humor,
  };
}

/** 외형 분위기는 질문하지 않고 타입에서 가져온다. */
export function vibeForArchetype(value: ArchetypeValue) {
  return getArchetype(value).defaults.vibe;
}

/** 화면 진행률 표시용. */
export const ONBOARDING_STEP_COUNT = ONBOARDING_QUESTIONS.length;

/**
 * 질문 정의와 답변 스키마가 어긋나면 여기서 컴파일 에러가 난다.
 * (한쪽에만 키를 추가하는 실수를 배포 전에 잡기 위한 장치)
 */
type AssertSameKeys<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

const _questionsMatchAnswers: AssertSameKeys<
  OnboardingQuestionKey,
  keyof OnboardingAnswers & string
> = true;
void _questionsMatchAnswers;
void APPEARANCE_VIBES;
