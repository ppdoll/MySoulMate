import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { MeModule } from './me/me.module';
import { SoulmateModule } from './soulmate/soulmate.module';

@Module({
  imports: [AppConfigModule, SupabaseModule, AuthModule, MeModule, SoulmateModule],
  controllers: [HealthController],
})
export class AppModule {}
