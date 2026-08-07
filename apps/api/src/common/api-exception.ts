import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode } from '@mysoulmate/shared';

/**
 * 프론트가 코드로 분기할 수 있는 예외.
 *
 * 메시지 문구는 자유롭게 바꿔도 되지만 `code`는 계약이다.
 * 예: insufficient_credits -> 충전 시트, model_rate_limited -> 재시도 안내.
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
    readonly retryAfterSeconds?: number,
  ) {
    const body: ApiErrorBody = { code, message };
    if (retryAfterSeconds !== undefined) body.retryAfterSeconds = retryAfterSeconds;
    super(body, status);
  }

  static unauthorized(message = '로그인이 필요합니다.') {
    return new ApiException('unauthorized', message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = '권한이 없습니다.') {
    return new ApiException('forbidden', message, HttpStatus.FORBIDDEN);
  }

  static notFound(message = '찾을 수 없습니다.') {
    return new ApiException('not_found', message, HttpStatus.NOT_FOUND);
  }

  static validationFailed(message: string) {
    return new ApiException('validation_failed', message, HttpStatus.BAD_REQUEST);
  }

  static insufficientCredits(message = '크레딧이 부족합니다.') {
    return new ApiException('insufficient_credits', message, HttpStatus.PAYMENT_REQUIRED);
  }

  static modelRateLimited(retryAfterSeconds = 30) {
    return new ApiException(
      'model_rate_limited',
      '지금 대화가 몰려 있어요. 잠시 후 다시 시도해 주세요.',
      HttpStatus.TOO_MANY_REQUESTS,
      retryAfterSeconds,
    );
  }

  static modelUnavailable(message = '응답을 만들지 못했어요. 크레딧은 돌려드렸습니다.') {
    return new ApiException('model_unavailable', message, HttpStatus.BAD_GATEWAY);
  }

  static contentBlocked(message = '이 내용은 도와드릴 수 없어요.') {
    return new ApiException('content_blocked', message, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  static alreadyClaimed(message = '이미 받았어요.') {
    return new ApiException('already_claimed', message, HttpStatus.CONFLICT);
  }

  static internal(message = '일시적인 오류가 발생했어요.') {
    return new ApiException('internal_error', message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
