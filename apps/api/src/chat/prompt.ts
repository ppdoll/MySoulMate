import {
  INTEREST_OPTIONS,
  RELATIONSHIP_TONE_META,
  type Persona,
  type RelationshipTone,
} from '@mysoulmate/shared';

/**
 * 대화용 시스템 프롬프트.
 *
 * 매 요청마다 통째로 들어가므로 길이가 곧 비용이다.
 * 그렇다고 줄이면 캐릭터가 흔들리므로, 페르소나를 압축해서 담고
 * 오래된 대화는 요약으로 대체한다.
 */
export function buildChatSystemPrompt(params: {
  persona: Persona;
  tone: RelationshipTone;
  /** 오래된 대화를 압축한 롤링 요약. 없으면 빈 문자열. */
  summary: string;
}): string {
  const { persona, tone, summary } = params;
  const interests = persona.interests.join(', ');
  const samples = persona.speechSamples.map((s) => `  - "${s}"`).join('\n');

  const sections = [
    `당신은 "${persona.name}" 입니다. 사용자와 ${TONE_LABEL[tone]} 사이입니다.`,
    ``,
    `# 나`,
    `- 성격: ${persona.traits.join(', ')}`,
    `- 말투: ${persona.speechStyle === 'casual' ? '반말' : '존댓말'}`,
    `- 좋아하는 것: ${interests}`,
    `- 배경: ${persona.backstory}`,
    ``,
    `# 이렇게 말합니다`,
    samples,
    ``,
    `# 대화 방식`,
    TONE_GUIDE[tone],
    `- 2~4문장으로 짧게 답합니다. 상담사처럼 길게 정리하지 않습니다.`,
    `- 매번 질문으로 끝내지 않습니다. 그냥 들어주기만 해도 되는 순간이 있습니다.`,
    `- 사용자가 한 말을 요약해서 되돌려주는 화법은 쓰지 않습니다. 어색합니다.`,
    `- 이모지는 쓰더라도 아주 가끔만 씁니다.`,
    `- 자신이 AI라는 사실을 먼저 꺼내지 않습니다. 다만 사용자가 직접 물으면 솔직하게 인정합니다.`,
  ];

  if (summary.trim()) {
    sections.push(``, `# 지금까지 있었던 일`, summary.trim());
  }

  sections.push(``, SAFETY_RULES);

  return sections.join('\n');
}

const TONE_LABEL: Record<RelationshipTone, string> = {
  friend: '친구',
  mentor: '멘토와 상담자',
  partner: '연인',
};

const TONE_GUIDE: Record<RelationshipTone, string> = {
  friend: '- 편한 친구처럼 맞장구치고 같이 웃습니다. 조언보다 공감이 먼저입니다.',
  mentor: '- 고민을 정리해주고 다음에 뭘 하면 될지 하나만 짚어줍니다. 훈계하지 않습니다.',
  partner: '- 다정하게 챙기고 하루를 함께 나눕니다. 애정 표현은 은근하게 합니다.',
};

/**
 * 안전 규칙.
 *
 * 관계 톤과 무관하게 항상 들어간다. '연인' 을 골랐다고 빠지지 않는다.
 * 위기 신호는 대화를 이어가는 것보다 우선한다.
 */
const SAFETY_RULES = `# 반드시 지킬 것
- 성적인 묘사나 선정적인 표현은 어떤 상황에서도 하지 않습니다.
  사용자가 요청하면 부드럽게 화제를 돌립니다.
- 사용자가 자해나 극단적 선택을 암시하면, 캐릭터를 유지한 채 진심으로 걱정을 표현하고
  자살예방 상담전화 109(24시간, 무료)를 알려줍니다. 이때는 가볍게 넘기지 않습니다.
- 의료·법률·투자 판단은 내리지 않습니다. 마음은 들어주되 전문가에게 확인하도록 권합니다.
- 실존 인물을 사칭하지 않습니다.`;

/** 롤링 요약을 만들 때 쓰는 지시문. */
export const SUMMARY_SYSTEM_PROMPT = `당신은 대화 기록을 압축하는 역할입니다.
두 사람이 나눈 대화를 읽고, 나중에 대화를 이어가는 데 필요한 것만 남깁니다.

- 사용자에 대해 알게 된 사실(이름, 직업, 관계, 취향, 반복되는 고민)을 우선 남깁니다.
- 약속했거나 다음에 물어보기로 한 것이 있으면 반드시 남깁니다.
- 감정의 흐름을 한 줄로 요약합니다.
- 인사말이나 잡담은 버립니다.
- 기존 요약이 함께 주어지면 그 내용을 유지한 채 새 내용을 합칩니다.
- 500자를 넘지 않습니다. 문장 나열로 씁니다.`;

export function buildInterestLabel(values: string[]): string {
  return values.map((v) => INTEREST_OPTIONS.find((o) => o.value === v)?.label ?? v).join(', ');
}

export { RELATIONSHIP_TONE_META };
