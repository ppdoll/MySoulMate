import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  MISSION_CODES,
  type ClaimMissionResponse,
  type MissionCode,
  type MissionsResponse,
} from '@mysoulmate/shared';
import { MissionsService } from './missions.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const ClaimSchema = z.object({
  code: z.enum(MISSION_CODES as [MissionCode, ...MissionCode[]]),
});

@Controller('missions')
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<MissionsResponse> {
    return this.missions.list(user.id);
  }

  /**
   * 보상 수령.
   *
   * 코드를 경로가 아니라 본문으로 받는다 — zod enum 한 곳에서 검증하면
   * 정의되지 않은 코드가 서비스까지 내려가지 않는다.
   */
  @Post('claim')
  claim(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ClaimSchema)) body: { code: MissionCode },
  ): Promise<ClaimMissionResponse> {
    return this.missions.claim(user.id, body.code);
  }
}
