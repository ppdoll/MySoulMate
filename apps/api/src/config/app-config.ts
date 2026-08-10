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

  /** 텍스트(페르소나·대화)용 키. 무료 티어 프로젝트 키를 여기에 둘 수 있다. */
  get geminiTextKey(): string {
    // env 검증에서 둘 중 하나는 반드시 있음을 보장한다.
    return (this.env.GEMINI_TEXT_API_KEY ?? this.env.GEMINI_API_KEY)!;
  }

  /** 이미지(아바타)용 키. 이미지는 무료 티어가 없어 결제 연결 프로젝트여야 한다. */
  get geminiImageKey(): string {
    return (this.env.GEMINI_IMAGE_API_KEY ?? this.env.GEMINI_API_KEY)!;
  }

  /** 두 용도가 서로 다른 키를 쓰는지. 기동 로그에 남겨 설정 실수를 빨리 알아채게 한다. */
  get geminiKeysSplit(): boolean {
    return this.geminiTextKey !== this.geminiImageKey;
  }

  /** 운영자 이메일 목록. 비교는 소문자로 한다 — 구글이 대소문자를 보존해서 돌려준다. */
  get adminEmails(): string[] {
    return (this.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  isAdmin(email: string | null): boolean {
    if (!email) return false;
    return this.adminEmails.includes(email.toLowerCase());
  }
}

@Global()
@Module({
  providers: [AppConfig],
  exports: [AppConfig],
})
export class AppConfigModule {}
