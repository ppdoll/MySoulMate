import { Module } from '@nestjs/common';
import { SoulmateController } from './soulmate.controller';
import { SoulmateService } from './soulmate.service';
import { PersonaService } from './persona.service';
import { AvatarService } from './avatar.service';
import { AiModule } from '../ai/ai.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [AiModule, CreditsModule],
  controllers: [SoulmateController],
  providers: [SoulmateService, PersonaService, AvatarService],
})
export class SoulmateModule {}
