import { Global, Injectable, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env';

@Injectable()
export class AppConfig {
  readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  /** CORS 허용 오리진 목록. */
  get allowedOrigins(): string[] {
    return this.env.WEB_ORIGIN.split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean);
  }

  /** Supabase가 공개하는 JWT 검증용 공개키 세트. */
  get jwksUrl(): string {
    return `${this.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  }

  /** 액세스 토큰의 iss 클레임 값. */
  get jwtIssuer(): string {
    return `${this.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  }

  get commit(): string | null {
    return this.env.VERCEL_GIT_COMMIT_SHA ?? null;
  }
}

@Global()
@Module({
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
