import { Module } from '@nestjs/common';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  controllers: [ReferralsController],
  providers: [ReferralsService],
  // 대화 한 턴이 끝날 때마다 ChatService 가 settle() 을 부른다.
  exports: [ReferralsService],
})
export class ReferralsModule {}
