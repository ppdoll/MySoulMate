/**
 * 토큰 사용량 기록.
 *
 * 무료 쿼터를 몇 턴으로 잡을지, thinking을 끌지, 컨텍스트를 얼마나 줄일지는
 * 전부 "한 번에 토큰이 얼마나 나가는가"에 달려 있다.
 * 추정으로 정하면 틀리기 때문에 매 호출의 실측값을 남긴다.
 */

export interface TokenUsage {
  /** 입력 토큰. 컨텍스트가 길어질수록 여기가 커진다. */
  input: number;
  /** 응답 토큰. */
  output: number;
  /** 사고 과정 토큰. 출력 단가로 과금되므로 끄면 바로 절감된다. */
  thoughts: number;
  /** 캐시에서 재사용된 입력 토큰. 할인 대상이다. */
  cached: number;
  total: number;
}

/**
 * 모델별 단가 (USD / 100만 토큰). 2026년 8월 공식 가격표 기준.
 *
 * 여기 없는 모델은 비용을 계산하지 않고 토큰 수만 남긴다.
 * 모르는 모델에 임의의 단가를 갖다 붙이면 틀린 숫자가 조용히 쌓인다.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3.6-flash': { input: 1.5, output: 7.5 },
  // 이미지 모델의 출력은 이미지 1장(1024px)이 1,290 토큰이다.
  'gemini-2.5-flash-image': { input: 0.3, output: 30 },
  'gemini-3.1-flash-image': { input: 0.3, output: 60 },
};

export function readUsage(metadata: unknown): TokenUsage {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  return {
    input: num(m.promptTokenCount),
    output: num(m.candidatesTokenCount),
    thoughts: num(m.thoughtsTokenCount),
    cached: num(m.cachedContentTokenCount),
    total: num(m.totalTokenCount),
  };
}

/** 유료 티어 기준 환산 비용. 무료 티어 키로 호출했다면 실제 청구액은 0이다. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = PRICING[model];
  if (!price) return null;

  // 사고 토큰도 출력 단가로 과금된다.
  const billedInput = Math.max(usage.input - usage.cached, 0);
  const billedOutput = usage.output + usage.thoughts;

  return (billedInput * price.input + billedOutput * price.output) / 1_000_000;
}

export function formatUsage(params: {
  purpose: string;
  model: string;
  usage: TokenUsage;
  elapsedMs: number;
}): string {
  const { usage } = params;
  const cost = estimateCostUsd(params.model, usage);
  const costText = cost === null ? '단가 미등록' : `≈$${cost.toFixed(5)} (유료 환산)`;

  const parts = [
    `in=${usage.input}`,
    `out=${usage.output}`,
    usage.thoughts > 0 ? `think=${usage.thoughts}` : null,
    usage.cached > 0 ? `cached=${usage.cached}` : null,
    `total=${usage.total}`,
  ].filter(Boolean);

  return `${params.purpose} ${params.model} ${parts.join(' ')} ${params.elapsedMs}ms ${costText}`;
}
