import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import {
  UpdateProfileSchema,
  type MeResponse,
  type UpdateProfileRequest,
} from '@mysoulmate/shared';
import { MeService } from './me.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  /** 로그인 직후 프론트가 처음 부르는 엔드포인트. 온보딩 여부와 지갑 상태를 함께 준다. */
  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.meService.getMe(user);
  }

  /**
   * 사용자 소개 저장.
   *
   * 이 값은 매 대화의 시스템 프롬프트에 들어간다.
   * 길이 상한은 비용 때문이고, 내용은 지시가 아니라 자료로 다뤄진다(prompt.ts 참고).
   */
  @Patch()
  @HttpCode(HttpStatus.NO_CONTENT)
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileRequest,
  ): Promise<void> {
    return this.meService.updateSelfIntro(user.id, body.selfIntro);
  }
}
