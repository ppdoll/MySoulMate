import { Controller, Get } from '@nestjs/common';
import type { MeResponse } from '@mysoulmate/shared';
import { MeService } from './me.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  /** 로그인 직후 프론트가 처음 부르는 엔드포인트. 온보딩 여부와 지갑 상태를 함께 준다. */
  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.meService.getMe(user);
  }
}
