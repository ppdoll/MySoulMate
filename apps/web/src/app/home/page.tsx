import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { HomeClient } from '@/components/home-client';

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  // 프로필과 지갑은 NestJS API가 소유한다(서비스 로직이 전부 그쪽에 있다).
  // 서버 컴포넌트는 로그인 여부만 판단하고 나머지는 클라이언트가 API로 가져온다.
  return <HomeClient />;
}
