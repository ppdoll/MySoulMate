import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import {
  OnboardingAnswersSchema,
  RegenerateAvatarSchema,
  UpdateSoulmateSchema,
  type OnboardingAnswers,
  type RegenerateAvatarRequest,
  type SoulmateResponse,
  type UpdateSoulmateRequest,
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

  /**
   * 설정 수정. 대화 기록과 기억은 그대로 남는다.
   *
   * 무료다 — 바꿀 수 있는 게 이름·관계·말투·프리셋 모습뿐이고 전부 비용이 0이다.
   * 얼굴을 새로 그리는 건 아래 재생성으로 남아 있다.
   */
  @Patch('soulmate')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateSoulmateSchema)) body: UpdateSoulmateRequest,
  ): Promise<SoulmateResponse> {
    return this.soulmates.updateSettings(user, body);
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
