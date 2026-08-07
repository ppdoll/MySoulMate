import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';

/**
 * 서버 컴포넌트/라우트 핸들러용 Supabase 클라이언트.
 *
 * 서버 컴포넌트에서는 쿠키를 쓸 수 없어서 setAll이 예외를 던진다.
 * 세션 갱신은 middleware가 담당하므로 여기서는 조용히 무시해도 안전하다.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 서버 컴포넌트에서 호출된 경우. middleware가 이미 갱신하고 있다.
        }
      },
    },
  });
}
