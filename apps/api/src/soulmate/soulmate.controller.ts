import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  OnboardingAnswersSchema,
  RegenerateAvatarSchema,
  type OnboardingAnswers,
  type RegenerateAvatarRequest,
  type SoulmateResponse,
} from '@mysoulmate/shared';
import { SoulmateService } from './soulmate.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApiException } from '../common/api-exception';

@Controller()
export class SoulmateController {
  constructor(private readonly soulmates: SoulmateService) {}

  /** 온보딩 완료. 페르소나와 첫 아바타를 만든다(무료). */
  @Post('onboarding')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(OnboardingAnswersSchema)) answers: OnboardingAnswers,
  ): Promise<SoulmateResponse> {
    return this.soulmates.create(user.id, answers);
  }

  @Get('soulmate')
  async get(@CurrentUser() user: AuthUser): Promise<SoulmateResponse> {
    const soulmate = await this.soulmates.get(user.id);
    if (!soulmate) throw ApiException.notFound('아직 소울메이트가 없어요.');
    return soulmate;
  }

  /** 아바타 재생성. 크레딧을 소모한다. */
  @Post('soulmate/avatar/regenerate')
  regenerate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RegenerateAvatarSchema)) body: RegenerateAvatarRequest,
  ): Promise<SoulmateResponse> {
    return this.soulmates.regenerateAvatar(user.id, body.changeRequest);
  }
}
