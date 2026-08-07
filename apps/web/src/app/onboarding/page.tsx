import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { OnboardingWizard } from '@/components/onboarding-wizard';

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  // 이미 소울메이트가 있는지는 API가 알고 있다.
  // 여기서 막지 않고, 중복 생성은 서버가 already_claimed로 거절한다(유니크 인덱스가 최종 방어선).
  return <OnboardingWizard />;
}
