import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * 환경변수 스키마.
 *
 * 부팅 시점에 한 번 검증하고 실패하면 즉시 죽인다.
 * 첫 요청에서야 "undefined를 읽을 수 없다" 로 터지는 것보다
 * 배포 로그에 "SUPABASE_URL 없음" 이 찍히는 편이 훨씬 빨리 고쳐진다.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  /** 허용할 프론트 오리진. 쉼표로 여러 개(프리뷰 배포용). */
  WEB_ORIGIN: z.string().min(1),

  SUPABASE_URL: z.url(),
  /** service_role 키. 절대 프론트로 나가면 안 된다. RLS를 우회하는 키다. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * 레거시 HS256 대칭 키를 쓰는 Supabase 프로젝트용 폴백.
   * 비대칭(ES256) 서명 키를 쓰는 프로젝트라면 비워두면 된다 — JWKS로 검증한다.
   */
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  /** Vercel이 자동 주입. 어떤 커밋이 떠 있는지 확인용. */
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;

  // 로컬 개발용. Vercel에는 .env 파일이 없고 환경변수가 이미 주입돼 있어 아무 일도 하지 않는다.
  loadDotenv({ quiet: true });

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`환경변수 설정이 올바르지 않습니다.\n${details}\n\napps/api/.env.example 을 참고하세요.`);
  }

  cached = parsed.data;
  return cached;
}
