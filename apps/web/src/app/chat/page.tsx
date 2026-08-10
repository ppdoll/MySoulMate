import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ChatView } from '@/components/chat-view';

export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/');

  // 소울메이트가 없으면 ChatView가 /onboarding 으로 보낸다(API가 not_found를 준다).
  return <ChatView />;
}
