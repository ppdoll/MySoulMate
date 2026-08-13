import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
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

  /**
   * 회원 탈퇴. 계정과 대화·기억·크레딧이 모두 사라지고 되돌릴 수 없다.
   *
   * 개인정보 처리방침이 약속한 파기 경로라 반드시 동작해야 한다.
   * 크레딧을 받지 않는다 — 자기 정보를 지우는 데 값을 매길 수는 없다.
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser): Promise<void> {
    return this.meService.deleteAccount(user.id);
  }
}
