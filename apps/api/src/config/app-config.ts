import { Global, Injectable, Module } from '@nestjs/common';
import { FREE_DAILY_CHAT_TURNS } from '@mysoulmate/shared';
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

  /** 하루 무료 대화 턴 수. 환경변수가 없으면 shared 기본값. */
  get freeDailyChatTurns(): number {
    return this.env.FREE_DAILY_CHAT_TURNS ?? FREE_DAILY_CHAT_TURNS;
  }

  /**
   * 푸시 알림 설정. 세 값이 다 있어야 보낼 수 있다.
   *
   * 하나라도 없으면 null 을 돌려주고 기능만 꺼진다 — 부팅은 막지 않는다.
   * 알림은 부가 기능이라, 키를 아직 안 만든 상태에서 서비스 전체가 안 뜨면 곤란하다.
   */
  get vapid(): { publicKey: string; privateKey: string; subject: string } | null {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = this.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return null;
    return {
      publicKey: VAPID_PUBLIC_KEY,
      privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT,
    };
  }

  /** 한 번의 발송에서 보낼 최대 인원. 문구를 모델로 만들어서 인원=호출 수다. */
  get pushBatchLimit(): number {
    return this.env.PUSH_BATCH_LIMIT ?? 50;
  }

  /** 이 시간 동안 대화가 없었던 사람에게만 보낸다. */
  get pushIdleHours(): number {
    return this.env.PUSH_IDLE_HOURS ?? 20;
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
