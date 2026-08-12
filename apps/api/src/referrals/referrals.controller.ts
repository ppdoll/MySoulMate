import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  EnterReferralSchema,
  type EnterReferralRequest,
  type EnterReferralResponse,
  type ReferralStatus,
} from '@mysoulmate/shared';
import { ReferralsService } from './referrals.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  status(@CurrentUser() user: AuthUser): Promise<ReferralStatus> {
    return this.referrals.status(user.id);
  }

  @Post()
  enter(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(EnterReferralSchema)) body: EnterReferralRequest,
  ): Promise<EnterReferralResponse> {
    return this.referrals.enter(user.id, body.code);
  }
}
