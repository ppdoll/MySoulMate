import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * 환경변수 스키마.
 *
 * 부팅 시점에 한 번 검증하고 실패하면 즉시 죽인다.
 * 첫 요청에서야 "undefined를 읽을 수 없다" 로 터지는 것보다
 * 배포 로그에 "SUPABASE_URL 없음" 이 찍히는 편이 훨씬 빨리 고쳐진다.
 */
/**
 * "비워둔다"는 곧 빈 문자열이다.
 *
 * .env 파일의 `KEY=` 나 Vercel 대시보드에 값 없이 등록한 항목은
 * undefined가 아니라 ''로 들어온다. .optional()은 undefined만 허용하므로
 * 그대로 두면 "비워두라"고 안내한 변수가 기동을 막는다.
 */
const optionalSecret = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  /** 허용할 프론트 오리진. 쉼표로 여러 개(프리뷰 배포용). */
  WEB_ORIGIN: z.string().min(1),

  SUPABASE_URL: z.url(),
  /**
   * 시크릿 키(`sb_secret_...`). RLS를 우회하므로 절대 프론트로 나가면 안 된다.
   * 구형 프로젝트의 service_role JWT 키를 넣어도 동작하지만, 그쪽은 2026년 말 폐기 예정이다.
   */
  SUPABASE_SECRET_KEY: z.string().min(1),
  /**
   * 레거시 HS256 대칭 키를 쓰는 Supabase 프로젝트용 폴백.
   * 비대칭(ES256) 서명 키를 쓰는 프로젝트라면 비워두면 된다 — JWKS로 검증한다.
   */
  SUPABASE_JWT_SECRET: optionalSecret,

  /**
   * Gemini 키. 텍스트와 이미지를 다른 키로 나눌 수 있다.
   *
   * 나누는 이유: 텍스트는 무료 티어가 있고 이미지는 없다.
   * 결제를 연결하지 않은 별도 프로젝트의 키를 텍스트에 쓰면 대화 비용이 0이 되고,
   * 결제가 연결된 프로젝트 키는 이미지에만 쓴다.
   * (선불 잔액이 0이 되면 그 결제 계정의 모든 키가 함께 막히므로 분리해두면 대화는 계속 산다)
   *
   * 나누지 않을 거면 GEMINI_API_KEY 하나만 채우면 된다.
   */
  GEMINI_API_KEY: optionalSecret,
  /** 무료 티어 프로젝트 키. 비우면 GEMINI_API_KEY를 쓴다. */
  GEMINI_TEXT_API_KEY: optionalSecret,
  /** 결제 연결 프로젝트 키. 비우면 GEMINI_API_KEY를 쓴다. */
  GEMINI_IMAGE_API_KEY: optionalSecret,

  /**
   * 모델 ID를 환경변수로 빼두는 이유: 모델이 자주 바뀌고 무료 티어 여부도 바뀐다.
   * 코드 배포 없이 갈아끼울 수 있어야 한다.
   *
   * 텍스트는 무료 티어가 있고(분당 10회 상한은 서비스 전체 공유),
   * 이미지는 2026년 8월 기준 무료 티어가 없어 장당 과금된다(2.5-flash-image ≈ $0.039).
   */
  GEMINI_TEXT_MODEL: z.string().default('gemini-3.6-flash'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-2.5-flash-image'),

  /** Vercel이 자동 주입. 어떤 커밋이 떠 있는지 확인용. */
  VERCEL_GIT_COMMIT_SHA: optionalSecret,
});

/**
 * 용도별 키가 하나도 해결되지 않으면 부팅을 막는다.
 * 첫 대화나 첫 아바타 생성에서야 "키 없음"으로 실패하면 원인 찾기가 오래 걸린다.
 */
const EnvSchemaWithKeys = EnvSchema.superRefine((env, ctx) => {
  for (const [purpose, specific] of [
    ['텍스트', env.GEMINI_TEXT_API_KEY],
    ['이미지', env.GEMINI_IMAGE_API_KEY],
  ] as const) {
    if (!specific && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: [purpose === '텍스트' ? 'GEMINI_TEXT_API_KEY' : 'GEMINI_IMAGE_API_KEY'],
        message: `${purpose}용 키가 없습니다. 이 값이나 GEMINI_API_KEY 중 하나를 채우세요.`,
      });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;

  // 로컬 개발용. Vercel에는 .env 파일이 없고 환경변수가 이미 주입돼 있어 아무 일도 하지 않는다.
  loadDotenv({ quiet: true });

  const parsed = EnvSchemaWithKeys.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`환경변수 설정이 올바르지 않습니다.\n${details}\n\napps/api/.env.example 을 참고하세요.`);
  }

  cached = parsed.data;
  return cached;
}
