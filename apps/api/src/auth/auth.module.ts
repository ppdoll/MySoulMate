import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard';

/**
 * 가드를 전역으로 등록한다. 기본값이 "인증 필수"이고,
 * 공개 엔드포인트만 @Public()으로 명시적으로 열어준다.
 */
@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AuthModule {}
