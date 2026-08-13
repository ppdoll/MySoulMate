import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  INTEREST_OPTIONS,
  PersonaSchema,
  RELATIONSHIP_TONE_META,
  SPEECH_STYLE_META,
  getArchetype,
  getPreset,
  type Appearance,
  type OnboardingAnswers,
  type Persona,
  type SpeechStyle,
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
    const persona = await this.gemini.generateJson({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(answers),
      schema: PersonaSchema,
      retries: 1,
    });

    // 이름은 사용자가 정한 값을 그대로 쓴다.
    // 프롬프트로 "바꾸지 마세요" 라고 해도 모델은 성을 붙이거나 다른 이름을 만들어낸다.
    // 부탁이 아니라 코드로 못박아야 한다 — 사용자가 처음 보는 이름이 나오면
    // "내가 만든 소울메이트" 라는 전제부터 깨진다.
    return { ...persona, name: answers.callName };
  }

  /**
   * 말투를 바꿀 때 예시 문장을 새 말투로 다시 쓴다.
   *
   * 이 호출이 없으면 말투 변경이 사실상 먹지 않는다. 시스템 프롬프트에는
   * `말투: 존댓말` 지시문과 speechSamples 가 함께 들어가는데, 예시가 전부 반말이면
   * 모델은 지시문보다 예시를 따라간다. 캐릭터는 그대로 두고 어미만 옮긴다.
   *
   * 텍스트 모델은 무료 티어가 있어서 이 호출에는 돈이 들지 않는다.
   */
  async restyle(persona: Persona, speechStyle: SpeechStyle): Promise<RestyledSpeech> {
    return this.gemini.generateJson({
      system: RESTYLE_SYSTEM_PROMPT,
      prompt: [
        `# 바꿀 말투`,
        `${SPEECH_STYLE_META[speechStyle].label} — ${SPEECH_STYLE_META[speechStyle].description}`,
        ``,
        `# 캐릭터`,
        `- 이름: ${persona.name}`,
        `- 성격: ${persona.traits.join(', ')}`,
        ``,
        `# 지금 문장들`,
        `oneLiner: ${persona.oneLiner}`,
        ...persona.speechSamples.map((s, i) => `speechSamples[${i}]: ${s}`),
      ].join('\n'),
      schema: RestyleSchema,
      retries: 1,
    });
  }
}

/**
 * 말투만 옮긴 결과. 캐릭터를 다시 만드는 게 아니라서 이 두 필드만 받는다.
 * traits 나 backstory 까지 손대면 "이름만 바꿨는데 성격이 달라졌다" 가 된다.
 */
const RestyleSchema = z.object({
  oneLiner: PersonaSchema.shape.oneLiner,
  speechSamples: PersonaSchema.shape.speechSamples,
});

type RestyledSpeech = z.infer<typeof RestyleSchema>;

const RESTYLE_SYSTEM_PROMPT = `당신은 캐릭터의 대사를 다른 말투로 옮기는 편집자입니다.

- 내용과 성격은 그대로 둡니다. 어미와 호칭만 새 말투에 맞춥니다.
- 문장 수와 길이 배분도 그대로 유지합니다. 짧은 문장은 짧게, 긴 문장은 길게 남깁니다.
  이 예시가 실제 대화의 길이를 정하므로 전부 한 줄로 줄이면 대화가 짧아집니다.
- 새로운 설정이나 사건을 넣지 않습니다. 이름을 바꾸지 않습니다.
- 반말이면 "오늘 어땠어?", 존댓말이면 "오늘 어떠셨어요?" 처럼 자연스럽게 씁니다.
  번역기처럼 어미만 기계적으로 갈아붙이지 않습니다.`;

const SYSTEM_PROMPT = `당신은 1인용 AI 동반자 서비스의 캐릭터 설정을 만드는 작가입니다.
사용자가 고른 조건을 읽고, 그 사람에게 맞춘 캐릭터 한 명을 설계해 JSON으로 출력합니다.

작성 규칙
- name, oneLiner, traits, speechSamples, backstory, interests, greeting 은 모두 한국어로 씁니다.
- appearancePrompt 만 영어로 씁니다. 이미지 생성 모델에 그대로 들어가는 문장입니다.
- **name 은 사용자가 정해준 이름을 글자 그대로 씁니다.** 성을 붙이거나, 줄이거나,
  더 자연스러운 이름으로 바꾸지 않습니다. 사용자가 "은우" 라고 했으면 "은우" 입니다.
- oneLiner 는 이 캐릭터가 사용자에게 건네는 짧은 한마디입니다. 소개문이 아니라 대사로 씁니다.
  말투(반말/존댓말)를 지킵니다.
- traits 는 성격 키워드입니다. 어미를 하나로 통일합니다
  (예: "활발한 / 다정한 / 든든한" 처럼 전부 '-한' 형태. 명사형과 형용사형을 섞지 않습니다).
- speechSamples 는 이 캐릭터가 실제로 할 법한 문장이어야 합니다. 사용자가 고른 말투(반말/존댓말)를 정확히 지킵니다.
  길이를 섞어 씁니다 — 짧은 맞장구 하나, 자기 얘기를 덧붙인 서너 문장짜리 하나처럼요.
  이 예시가 실제 대화의 길이를 정하므로 전부 한 줄짜리로 쓰면 대화가 계속 짧아집니다.
- greeting 은 첫 대화창에 바로 뜨는 인사말입니다. 처음 만난 사이답게, 부담스럽지 않게 씁니다.
- backstory 는 대화에 일관성을 주기 위한 짧은 설정입니다. 지나치게 극적인 사연은 넣지 않습니다.
- 실존 인물이나 특정 연예인을 모델로 삼지 않습니다.

appearancePrompt 작성 규칙
- 성인의 외모로만 묘사합니다. 나이를 암시할 때는 20대 후반 이상으로 씁니다.
- 얼굴 특징(눈매, 헤어스타일, 인상), 복장, 배경 색감, 분위기를 구체적으로 적습니다.
  나중에 같은 인물을 다시 그릴 때 기준이 되는 문장이라 모호하면 안 됩니다.
- **캐릭터의 생김새만 적습니다.** 화풍(일러스트/사진체 등), 구도, 화면 비율은 쓰지 않습니다.
  그건 시스템이 따로 붙이므로, 여기에 또 적으면 지시가 충돌합니다.
- 배경은 단색이나 아주 단순한 것으로 묘사합니다. 소품을 넣지 않습니다.
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

  // 성별 표현은 고른 프리셋 캐릭터에서 가져온다.
  const presentation = getPreset(answers.presetId).presentation;

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
    `- 인상: ${PRESENTATION_HINT[presentation]}`,
    `- 분위기 방향(영어, appearancePrompt의 뼈대로 사용): ${archetype.visualDirection}`,
  ];

  lines.push(
    ``,
    `name 필드에는 정확히 "${answers.callName}" 를 넣습니다. 다른 이름을 만들지 않습니다.`,
  );

  return lines.join('\n');
}

const PRESENTATION_HINT: Record<Appearance['presentation'], string> = {
  feminine: 'a woman',
  masculine: 'a man',
  neutral: 'an androgynous person',
};
