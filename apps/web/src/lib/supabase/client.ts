'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../env';

let cached: SupabaseClient | undefined;

/**
 * 브라우저용 Supabase 클라이언트.
 *
 * 하나만 만들어 재사용한다. 컴포넌트마다 새로 만들면 세션 리스너가 중복 등록되고
 * 토큰 갱신이 여러 번 일어난다.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  cached ??= createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return cached;
}
