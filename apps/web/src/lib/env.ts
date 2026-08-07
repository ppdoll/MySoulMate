/**
 * 프론트에서 쓰는 공개 환경변수.
 *
 * Next.js는 NEXT_PUBLIC_* 를 빌드 타임에 문자열로 치환하므로
 * process.env를 동적으로 순회할 수 없다. 반드시 통째로 적어야 값이 박힌다.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `환경변수 ${name} 이(가) 없습니다. apps/web/.env.example 을 참고해 .env.local 을 채우세요.`,
    );
  }
  return value.replace(/\/$/, '');
}

export const SUPABASE_URL = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

/**
 * publishable 키(`sb_publishable_...`). 공개되어도 되는 키다 — RLS로 막혀 있다.
 * 구형 프로젝트의 anon JWT 키를 넣어도 동작한다(2026년 말 폐기 예정).
 */
export const SUPABASE_PUBLISHABLE_KEY = required(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/** NestJS API의 베이스 URL. 로컬은 http://localhost:3001 */
export const API_URL = required('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL);
