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

/** 자동으로 쌓이는 기억의 최대 개수. 넘으면 덜 중요하고 오래된 것부터 지운다. */
export const MEMORY_STORE_LIMIT = 80;

/**
 * 고정할 수 있는 기억의 최대 개수.
 *
 * 고정한 기억은 회상 목록의 맨 앞을 차지한다. 상한이 없으면 고정만으로
 * 자리(MEMORY_RECALL_LIMIT)를 다 채워서, 방금 나눈 대화에서 나온 기억이
 * 프롬프트에 못 들어간다. 절반으로 나눠 둔다.
 */
export const MEMORY_PIN_LIMIT = 12;

/** 사용자에게 보여주는 기억 한 건. */
export interface MemoryDto {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  pinned: boolean;
  createdAt: string;
}

export interface MemoryListResponse {
  memories: MemoryDto[];
  /** 고정한 개수. UI가 상한에 닿았는지 알려주는 데 쓴다. */
  pinnedCount: number;
  pinLimit: number;
}

/** 사용자가 직접 적는 기억. 기다리지 않고 지금 알려주고 싶을 때 쓴다. */
export const CreateMemorySchema = z.object({
  kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(1).max(200),
  importance: z.number().int().min(1).max(3).default(2),
  /** 직접 적은 건 기본으로 고정한다 — 자동 정리에 밀려나면 적은 의미가 없다. */
  pinned: z.boolean().default(true),
});

export type CreateMemoryRequest = z.input<typeof CreateMemorySchema>;

export const UpdateMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(200).optional(),
    importance: z.number().int().min(1).max(3).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '바꿀 내용이 없어요.' });

export type UpdateMemoryRequest = z.infer<typeof UpdateMemorySchema>;
