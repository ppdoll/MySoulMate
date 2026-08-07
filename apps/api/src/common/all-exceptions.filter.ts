import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody, ApiErrorCode } from '@mysoulmate/shared';

/**
 * 모든 오류 응답을 ApiErrorBody 한 가지 모양으로 정규화한다.
 *
 * 이게 없으면 NestJS 기본 예외(문자열 message), 우리 예외(code 포함),
 * 잡히지 않은 런타임 오류(스택 노출)가 제각각 다른 형태로 나가서
 * 프론트가 모든 경우를 방어해야 한다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, body } = this.normalize(exception);

    // 5xx는 원인을 봐야 하므로 스택까지 남긴다. 4xx는 사용자 실수라 한 줄로 충분하다.
    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} -> ${status} ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${req.method} ${req.url} -> ${status} ${body.code}: ${body.message}`);
    }

    if (body.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(body.retryAfterSeconds));
    }
    res.status(status).json(body);
  }

  private normalize(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // ApiException이 심어둔 본문이면 그대로 통과시킨다.
      if (isApiErrorBody(payload)) {
        return { status, body: payload };
      }

      // NestJS 내장 예외(NotFoundException 등)를 우리 코드 체계로 옮긴다.
      const message =
        typeof payload === 'string'
          ? payload
          : typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message: unknown }).message)
            : exception.message;

      return { status, body: { code: statusToCode(status), message } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'internal_error', message: '일시적인 오류가 발생했어요.' },
    };
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    typeof (value as ApiErrorBody).code === 'string'
  );
}

function statusToCode(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.BAD_REQUEST:
      return 'validation_failed';
    case HttpStatus.PAYMENT_REQUIRED:
      return 'insufficient_credits';
    case HttpStatus.CONFLICT:
      return 'already_claimed';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'model_rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'validation_failed';
  }
}
