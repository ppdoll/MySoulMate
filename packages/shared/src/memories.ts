import { z } from 'zod';

/**
 * 장기 기억.
 *
 * 롤링 요약과 역할이 다르다.
 * 요약은 "회사 일로 스트레스를 받고 있다" 처럼 흐름을 뭉개서 남기고,
 * 기억은 "금요일에 팀 발표가 있다" 처럼 구체적인 사실을 그대로 남긴다.
 * 다시 만났을 때 "그 발표 어떻게 됐어?" 가 나오려면 후자가 필요하다.
 */

export const MEMORY_KINDS = ['fact', 'event', 'concern', 'preference'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_KIND_HINT: Record<MemoryKind, string> = {
  fact: '사용자에 대해 알게 된 사실 (이름, 직업, 사는 곳, 가족, 반려동물)',
  event: '예정된 일이나 약속 (날짜가 있는 것, 다음에 물어보기로 한 것)',
  concern: '반복해서 나오는 고민이나 걱정',
  preference: '취향이나 싫어하는 것',
};

export const MemoryItemSchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  /** 한 문장. 나중에 그대로 프롬프트에 들어가므로 길면 안 된다. */
  content: z.string().trim().min(1).max(200),
  /** 1(참고) ~ 3(꼭 기억). 프롬프트에 넣을 것을 고를 때 쓴다. */
  importance: z.number().int().min(1).max(3),
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;

/**
 * 요약과 기억을 한 번의 호출로 받는다.
 *
 * 둘 다 "창에서 밀려나는 메시지" 를 읽어야 하므로 입력이 같다.
 * 따로 부르면 같은 대화를 두 번 읽히면서 호출 수만 두 배가 된다.
 */
export const CompressionSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  memories: z.array(MemoryItemSchema).max(8),
});

export type Compression = z.infer<typeof CompressionSchema>;

/** 프롬프트에 넣을 기억의 최대 개수. 늘리면 매 턴 입력 토큰이 그만큼 늘어난다. */
export const MEMORY_RECALL_LIMIT = 24;

/** 한 소울메이트가 들고 있을 기억의 최대 개수. 넘으면 오래된 것부터 지운다. */
export const MEMORY_STORE_LIMIT = 80;
