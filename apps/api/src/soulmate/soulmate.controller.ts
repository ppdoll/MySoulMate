import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
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
    return this.soulmates.create(user, answers);
  }

  @Get('soulmate')
  async get(@CurrentUser() user: AuthUser): Promise<SoulmateResponse> {
    const soulmate = await this.soulmates.get(user.id);
    if (!soulmate) throw ApiException.notFound('아직 소울메이트가 없어요.');
    return soulmate;
  }

  /** 아바타 생성/재생성. 첫 아바타는 무료, 이후는 크레딧을 쓴다. */
  @Post('soulmate/avatar/regenerate')
  regenerate(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(RegenerateAvatarSchema)) body: RegenerateAvatarRequest,
  ): Promise<SoulmateResponse> {
    return this.soulmates.regenerateAvatar(user, body.changeRequest);
  }

  /**
   * 소울메이트를 지운다. 대화 기록까지 함께 사라진다.
   * 지운 뒤 /onboarding 으로 처음부터 다시 만들 수 있다.
   */
  @Delete('soulmate')
  @HttpCode(HttpStatus.NO_CONTENT)
  reset(@CurrentUser() user: AuthUser): Promise<void> {
    return this.soulmates.reset(user);
  }
}
