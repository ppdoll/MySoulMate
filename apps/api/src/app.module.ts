import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { MeModule } from './me/me.module';
import { SoulmateModule } from './soulmate/soulmate.module';
import { ChatModule } from './chat/chat.module';
import { MemoriesModule } from './memories/memories.module';
import { MissionsModule } from './missions/missions.module';
import { ReferralsModule } from './referrals/referrals.module';

@Module({
  imports: [
    AppConfigModule,
    SupabaseModule,
    AuthModule,
    MeModule,
    SoulmateModule,
    ChatModule,
    MemoriesModule,
    MissionsModule,
    ReferralsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
