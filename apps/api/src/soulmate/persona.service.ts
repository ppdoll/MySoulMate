import { Injectable } from '@nestjs/common';
import {
  INTEREST_OPTIONS,
  PersonaSchema,
  RELATIONSHIP_TONE_META,
  SPEECH_STYLE_META,
  getArchetype,
  type OnboardingAnswers,
  type Persona,
} from '@mysoulmate/shared';
import { GeminiService } from '../ai/gemini.service';

/**
 * 온보딩 답변 → 페르소나 JSON.
 *
 * 자유 텍스트로 캐릭터를 받으면 대화마다 말투가 흔들린다.
 * PersonaSchema를 모델에 강제하고 같은 스키마로 검증해서, 이후 모든 대화가
 * 동일한 시스템 프롬프트 위에서 돌아가도록 한다.
 */
@Injectable()
export class PersonaService {
  constructor(private readonly gemini: GeminiService) {}

  async generate(answers: OnboardingAnswers): Promise<Persona> {
    return this.gemini.generateJson({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(answers),
      schema: PersonaSchema,
      retries: 1,
    });
  }
}

const SYSTEM_PROMPT = `당신은 1인용 AI 동반자 서비스의 캐릭터 설정을 만드는 작가입니다.
사용자가 고른 조건을 읽고, 그 사람에게 맞춘 캐릭터 한 명을 설계해 JSON으로 출력합니다.

작성 규칙
- name, oneLiner, traits, speechSamples, backstory, interests, greeting 은 모두 한국어로 씁니다.
- appearancePrompt 만 영어로 씁니다. 이미지 생성 모델에 그대로 들어가는 문장입니다.
- speechSamples 는 이 캐릭터가 실제로 할 법한 문장이어야 합니다. 사용자가 고른 말투(반말/존댓말)를 정확히 지킵니다.
- greeting 은 첫 대화창에 바로 뜨는 인사말입니다. 처음 만난 사이답게, 부담스럽지 않게 씁니다.
- backstory 는 대화에 일관성을 주기 위한 짧은 설정입니다. 지나치게 극적인 사연은 넣지 않습니다.
- 실존 인물이나 특정 연예인을 모델로 삼지 않습니다.

appearancePrompt 작성 규칙
- 성인의 외모로만 묘사합니다. 나이를 암시할 때는 20대 후반 이상으로 씁니다.
- 얼굴 특징(눈매, 헤어스타일, 인상), 복장, 조명, 분위기를 구체적으로 적습니다.
  나중에 같은 인물을 다시 그릴 때 기준이 되는 문장이라 모호하면 안 됩니다.
- 상반신 인물 사진 구도로 씁니다.
- 선정적이거나 신체를 강조하는 표현은 넣지 않습니다.

안전 규칙
- 성적인 묘사, 폭력적인 설정, 특정 집단을 비하하는 성격은 어떤 조건에서도 만들지 않습니다.
- 사용자가 '연인' 관계를 골랐더라도 애정 표현의 수위는 다정한 정도까지입니다.`;

function buildPrompt(answers: OnboardingAnswers): string {
  const archetype = getArchetype(answers.archetype);
  const tone = RELATIONSHIP_TONE_META[answers.tone];
  const speech = SPEECH_STYLE_META[answers.speechStyle];
  const interests = answers.interests
    .map((v) => INTEREST_OPTIONS.find((o) => o.value === v)?.label ?? v)
    .join(', ');

  const lines = [
    `# 큰 줄기`,
    `${archetype.label} — ${archetype.tagline}`,
    archetype.description,
    ``,
    `# 조건`,
    `- 부를 이름: ${answers.callName}`,
    `- 관계: ${tone.label} (${tone.description})`,
    `- 말투: ${speech.label}`,
    `- 성격 축 (1~5)`,
    `  - 차분함 1 ↔ 5 활발함: ${answers.energy}`,
    `  - 논리적으로 정리 1 ↔ 5 먼저 공감: ${answers.thinking}`,
    `  - 진지함 1 ↔ 5 장난스러움: ${answers.humor}`,
    `- 자주 나눌 이야기: ${interests}`,
    ``,
    `# 외형`,
    `- 인상: ${PRESENTATION_HINT[answers.presentation]}`,
    `- 분위기 방향(영어, appearancePrompt의 뼈대로 사용): ${archetype.visualDirection}`,
  ];

  if (answers.appearanceNote) {
    // 사용자가 직접 쓴 요청이므로 다른 조건보다 우선한다.
    lines.push(
      `- 사용자가 직접 요청한 외형: ${answers.appearanceNote}`,
      `  이 요청은 위 분위기 방향보다 우선해서 반영합니다.`,
    );
  }

  lines.push(
    ``,
    `이름은 "${answers.callName}" 를 그대로 쓰되, 어색하면 자연스럽게 다듬어도 됩니다.`,
  );

  return lines.join('\n');
}

const PRESENTATION_HINT: Record<OnboardingAnswers['presentation'], string> = {
  feminine: 'a woman',
  masculine: 'a man',
  neutral: 'an androgynous person',
};
