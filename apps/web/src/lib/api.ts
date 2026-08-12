'use client';

import type { ApiErrorBody, ApiErrorCode } from '@mysoulmate/shared';
import { API_URL } from './env';
import { getSupabaseBrowserClient } from './supabase/client';

/**
 * NestJS API 호출 래퍼.
 *
 * 오류는 전부 ApiError로 정규화한다. 화면에서는 `code`로 분기하면 되고
 * (insufficient_credits -> 충전 시트, model_rate_limited -> 재시도 안내)
 * 문구는 서버가 준 message를 그대로 보여주면 된다.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authHeader(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new ApiError('unauthorized', '로그인이 필요합니다.', 401);
  }
  return `Bearer ${session.access_token}`;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
      Authorization: await authHeader(),
    },
  });

  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/**
 * SSE 스트리밍용. EventSource는 헤더를 붙일 수 없어서
 * fetch + ReadableStream으로 직접 읽는다(채팅에서 쓴다).
 */
export async function apiStream(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: await authHeader(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw await toApiError(res);
  }
  return res;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    // 게이트웨이 오류처럼 JSON이 아닌 응답도 있다.
  }
  return new ApiError(
    body.code ?? 'internal_error',
    body.message ?? '요청을 처리하지 못했어요.',
    res.status,
    body.retryAfterSeconds,
  );
}
