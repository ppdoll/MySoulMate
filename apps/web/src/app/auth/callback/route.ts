import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * 구글 로그인 후 돌아오는 지점. 인가 코드를 세션으로 교환한다.
 *
 * Supabase 대시보드의 Redirect URLs에 이 경로를 등록해야 한다:
 *   http://localhost:3000/auth/callback
 *   https://<배포도메인>/auth/callback
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const base = resolveBaseUrl(request, origin);

  // 사용자가 구글 동의 화면에서 취소하면 code 없이 error만 붙어 돌아온다.
  const oauthError = searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${base}/?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${base}/?error=auth_failed`);
  }

  return NextResponse.redirect(`${base}${safeNext(searchParams.get('next'))}`);
}

/**
 * Vercel은 프록시 뒤에 있어서 request.url의 origin이 내부 주소로 나온다.
 * 그대로 리다이렉트하면 사용자가 접근할 수 없는 URL로 보내게 된다.
 */
function resolveBaseUrl(request: Request, origin: string): string {
  if (process.env.NODE_ENV === 'development') return origin;

  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${forwardedHost}`;
  }
  return origin;
}

/** 오픈 리다이렉트 방지 — 같은 사이트의 절대경로만 허용한다. */
function safeNext(next: string | null): string {
  if (!next) return '/home';
  if (!next.startsWith('/') || next.startsWith('//')) return '/home';
  return next;
}
