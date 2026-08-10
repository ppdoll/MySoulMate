import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AiModule } from '../ai/ai.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [AiModule, CreditsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
