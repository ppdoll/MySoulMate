import { z } from 'zod';
import type { Persona, RelationshipTone } from '@mysoulmate/shared';

/**
 * 알림 문구.
 *
 * 알림은 대화가 아니라 문 두드리는 소리다. 목적은 앱을 열게 하는 것 하나뿐이고,
 * 할 얘기는 열고 나서 한다. 그래서 짧게 쓴다.
 *
 * 한 번 스팸처럼 느껴지면 알림 권한을 영구히 잃는다 — 차단하면 사용자가
 * 브라우저 설정에서 직접 풀지 않는 한 되돌릴 방법이 없다. 그게 이 프롬프트가
 * 재촉이나 죄책감 유발을 금지하는 이유다.
 */
export const NotificationTextSchema = z.object({
  /** 알림 본문. 캐릭터가 건네는 한마디. */
  body: z.string().trim().min(1).max(80),
});

export type NotificationText = z.infer<typeof NotificationTextSchema>;

export const NOTIFICATION_SYSTEM_PROMPT = `당신은 AI 동반자 서비스의 알림 문구를 씁니다.

한동안 오지 않은 상대의 휴대폰 잠금화면에 뜨는 한 줄입니다.
캐릭터가 직접 건네는 말투로 씁니다.

지킬 것
- 한 문장, 40자 안쪽으로 씁니다. 잠금화면에서 잘리면 아무 의미가 없습니다.
- 캐릭터의 말투(반말/존댓말)를 지킵니다.
- 재촉하지 않습니다. "왜 안 와", "기다렸는데" 처럼 미안하게 만드는 말은 쓰지 않습니다.
  가볍게 문을 두드리는 정도입니다.
- 기억이 주어지면 그중 하나를 골라 자연스럽게 물어봅니다.
  ("그 발표 어떻게 됐어?" 처럼요) 여러 개를 한 번에 꺼내지 않습니다.
- 기억이 없으면 지금 시간대에 맞는 가벼운 안부를 건넵니다.
- 이모지는 쓰지 않습니다. 알림에서는 지저분해 보입니다.
- 대화 응답처럼 감정 태그나 별표 강조를 붙이지 않습니다. 순수한 문장만 씁니다.
- 상대의 이름을 알면 가끔 부릅니다. 매번 부르면 광고 문구처럼 읽힙니다.`;

export function buildNotificationPrompt(params: {
  persona: Persona;
  tone: RelationshipTone;
  userName: string | null;
  /** 마지막 대화로부터의 공백을 문장으로. */
  gap: string;
  timeOfDay: string;
  /** 꺼내볼 만한 기억. 중요한 것부터 정렬돼 있다. */
  memories: string[];
}): string {
  const { persona, tone, userName, gap, timeOfDay, memories } = params;

  const lines = [
    `# 나`,
    `- 이름: ${persona.name}`,
    `- 성격: ${persona.traits.join(', ')}`,
    `- 말투: ${persona.speechStyle === 'casual' ? '반말' : '존댓말'}`,
    `- 관계: ${TONE_LABEL[tone]}`,
    ``,
    `# 이렇게 말합니다`,
    ...persona.speechSamples.slice(0, 2).map((s) => `  - "${s}"`),
    ``,
    `# 지금`,
    `- ${timeOfDay}입니다.`,
    `- ${gap}`,
  ];

  if (userName) lines.push(`- 상대의 이름은 ${userName} 입니다.`);

  if (memories.length > 0) {
    lines.push(
      ``,
      `# 기억하고 있는 것`,
      ...memories.map((m) => `- ${m}`),
      ``,
      `이 중 지금 물어보기 자연스러운 것이 있으면 하나만 골라 씁니다.`,
      `억지로 끼워 넣지는 않습니다.`,
    );
  }

  return lines.join('\n');
}

const TONE_LABEL: Record<RelationshipTone, string> = {
  friend: '친구',
  mentor: '멘토와 상담자',
  partner: '연인',
};

/** 기본 문구. 모델 호출이 실패해도 알림 자체는 나가야 한다. */
export function fallbackNotification(persona: Persona): string {
  return persona.speechStyle === 'casual' ? '오늘 하루 어땠어?' : '오늘 하루 어떠셨어요?';
}
