import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/env';

/**
 * Supabase 세션 쿠키를 갱신한다.
 *
 * 이게 없으면 액세스 토큰이 만료된 뒤 서버 컴포넌트가 "로그아웃 상태"로 보고
 * 사용자를 로그인 화면으로 튕긴다. 갱신은 여기서만 일어난다 —
 * 서버 컴포넌트는 쿠키를 쓸 수 없기 때문이다.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser()를 불러야 만료된 토큰이 갱신된다. getSession()은 갱신하지 않는다.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * 정적 자원과 이미지 최적화 경로를 제외한 전부.
     * 매 요청마다 Supabase를 호출하므로 대상을 넓히면 그만큼 느려진다.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
