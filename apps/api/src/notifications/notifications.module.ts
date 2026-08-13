import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { AiModule } from '../ai/ai.module';

@Module({
  // 알림 문구를 모델로 만든다.
  imports: [AiModule],
  controllers: [NotificationsController],
  providers: [PushService, NotificationsService],
})
export class NotificationsModule {}
