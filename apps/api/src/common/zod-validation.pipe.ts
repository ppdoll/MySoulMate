import { Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from './api-exception';

/**
 * zod 스키마로 요청 본문을 검증하는 파이프.
 *
 * class-validator 대신 zod를 쓰는 이유: 온보딩 답변·페르소나 같은 스키마를
 * packages/shared에 두고 web과 api가 같은 정의를 쓰기 위해서다.
 * 데코레이터 기반 검증은 프론트에서 재사용할 수 없다.
 *
 * 사용: `@Body(new ZodValidationPipe(OnboardingAnswersSchema)) body: OnboardingAnswers`
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join(', ');
      throw ApiException.validationFailed(`요청 형식이 올바르지 않습니다 — ${detail}`);
    }
    return result.data;
  }
}
