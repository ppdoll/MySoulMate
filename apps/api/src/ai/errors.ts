/**
 * 모델 제공자 오류를 우리 도메인 언어로 정규화한다.
 *
 * 호출부가 Gemini의 오류 형태를 직접 알 필요가 없어야
 * 나중에 유료 티어 프로바이더를 붙일 때 분기 코드를 고치지 않는다.
 */

/** 무료 티어 분당 한도(서비스 전체 공유)에 걸렸다. 재시도하면 될 수 있다. */
export class ModelRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds = 30) {
    super('model rate limited');
    this.name = 'ModelRateLimitedError';
  }
}

/** 제공자 장애, 타임아웃, 예상치 못한 응답 형태. 재시도해도 될지 알 수 없다. */
export class ModelUnavailableError extends Error {
  constructor(message = 'model unavailable') {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/** 안전 정책에 걸려 생성이 거부됐다. 같은 입력으로 재시도해도 소용없다. */
export class ModelBlockedError extends Error {
  constructor(message = 'content blocked by provider') {
    super(message);
    this.name = 'ModelBlockedError';
  }
}

/**
 * SDK가 던진 오류를 위 세 가지 중 하나로 바꾼다.
 * 상태 코드가 없는 경우가 많아 메시지 문자열도 함께 본다.
 */
export function normalizeProviderError(err: unknown): Error {
  const status = extractStatus(err);
  const message = err instanceof Error ? err.message : String(err);

  if (status === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(message)) {
    return new ModelRateLimitedError(extractRetryAfter(message));
  }
  if (status === 400 && /SAFETY|blocked|prohibited/i.test(message)) {
    return new ModelBlockedError(message);
  }
  if (status !== undefined && status >= 500) {
    return new ModelUnavailableError(message);
  }
  return new ModelUnavailableError(message);
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { status?: unknown; code?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.code === 'number') return candidate.code;
  return undefined;
}

/** 구글은 "retryDelay":"27s" 형태로 대기 시간을 알려줄 때가 있다. */
function extractRetryAfter(message: string): number {
  const match = /retryDelay["'\s:]+(\d+)s/i.exec(message);
  if (!match?.[1]) return 30;
  const seconds = Number.parseInt(match[1], 10);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1), 300) : 30;
}
