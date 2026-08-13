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
const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const optionalSecret = z.preprocess(blankToUndefined, z.string().min(1).optional());

/**
 * 비워둘 수 있는 정수.
 *
 * z.coerce.number() 는 '' 를 0 으로 바꿔버린다.
 * 그래서 빈 값 처리를 뒤쪽 분기(.or)에 두면 아예 도달하지 않고,
 * "비워두면 기본값" 이 "비워두면 0" 이 된다.
 * 반드시 coerce 앞에서 undefined 로 정규화해야 한다.
 */
const optionalInt = (min: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 빈 값이면 기본값을 쓴다. coerce 앞에서 정규화하지 않으면 ''가 0으로 바뀐다.
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(3001)),

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

  /**
   * 사고(thinking) 강도. 비워두면 모델 기본값을 그대로 쓴다.
   *
   * 사고 토큰은 출력 단가로 과금되는데, 실측해보면 출력보다 훨씬 크다.
   * ("안녕"만 답하는 호출에서 out=6 / think=290)
   * 다만 낮추면 품질이 어떻게 변하는지는 실제 결과물로 확인해야 하므로
   * 기본값을 바꾸지 않고 env로 실험할 수 있게만 열어둔다.
   *
   * MINIMAL 로 두면 대부분의 사고 토큰이 사라진다. 모델에 따라 허용 범위가 다르다.
   */
  GEMINI_THINKING_LEVEL: z
    .enum(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'])
    .optional()
    .or(z.literal('').transform(() => undefined)),

  /**
   * 운영자 이메일. 쉼표로 여러 개.
   *
   * 이 계정들은 크레딧과 무료 쿼터 제한을 받지 않는다.
   * DB 컬럼이 아니라 환경변수로 두는 이유: 값이 새거나 버그가 나도
   * 사용자가 스스로를 운영자로 만들 수 없어야 한다.
   */
  ADMIN_EMAILS: optionalSecret,

  /**
   * 하루 무료 대화 턴 수. 비우면 packages/shared 의 기본값(30)을 쓴다.
   *
   * 환경변수로 빼두는 이유가 둘이다.
   * - 테스트: 30턴을 다 태워봐야 소진 화면을 확인할 수 있는데, 2로 낮추면 세 번이면 된다.
   * - 운영: 실측 비용을 보고 조정해야 하는 값이다. 코드 배포 없이 바꿀 수 있어야 한다.
   */
  FREE_DAILY_CHAT_TURNS: optionalInt(0),

  /**
   * 웹 푸시 VAPID 키쌍.
   *
   * 셋 다 비워두면 푸시 기능만 꺼진다 — 없다고 부팅을 막지는 않는다.
   * 알림은 부가 기능이고, 키를 아직 안 만든 상태에서 서비스 전체가 안 뜨면 곤란하다.
   * (키 생성: pnpm --filter @mysoulmate/api vapid:keys)
   *
   * PUBLIC 키는 브라우저에도 나가는 값이라 비밀이 아니다.
   * PRIVATE 키가 새면 우리 이름으로 알림을 보낼 수 있게 되므로 절대 프론트로 내보내지 않는다.
   */
  VAPID_PUBLIC_KEY: optionalSecret,
  VAPID_PRIVATE_KEY: optionalSecret,
  /** 푸시 서비스가 문제가 생겼을 때 연락할 곳. `mailto:` 로 시작해야 한다. */
  VAPID_SUBJECT: optionalSecret,

  /**
   * Vercel Cron 이 보내는 시크릿.
   *
   * 발송 엔드포인트는 로그인 토큰 없이 열려 있어야 해서(cron 은 사용자가 아니다)
   * 이 값으로 막는다. 비워두면 그 엔드포인트가 아예 동작하지 않는다 —
   * 실수로 시크릿 없이 배포했을 때 아무나 알림을 쏘게 되는 쪽이 훨씬 나쁘다.
   */
  CRON_SECRET: optionalSecret,

  /**
   * 한 번의 발송에서 보낼 최대 인원.
   *
   * 알림 문구를 모델로 만들기 때문에 인원 수만큼 호출이 나간다.
   * 무료 티어는 분당 10회 / 하루 1500회가 서비스 전체 상한이라 상한이 없으면
   * 알림 한 번에 그날 대화용 쿼터까지 태울 수 있다.
   */
  PUSH_BATCH_LIMIT: optionalInt(1),
  /** 이 시간 동안 대화가 없었던 사람에게만 보낸다. 대화 중인 사람을 찌르지 않기 위한 값. */
  PUSH_IDLE_HOURS: optionalInt(0),

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
