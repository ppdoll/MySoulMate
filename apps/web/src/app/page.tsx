import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ConsentGate } from '@/components/consent-gate';
import { ReferralCatcher } from '@/components/referral-catcher';

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: '로그인이 완료되지 않았어요. 다시 시도해 주세요.',
  auth_failed: '로그인 처리 중 문제가 생겼어요. 다시 시도해 주세요.',
  access_denied: '구글 로그인을 취소했어요.',
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ref?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/home');

  const { error, ref } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth_failed) : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      {/* 로그인하면 쿼리스트링이 사라진다. 그 전에 초대 코드를 챙겨둔다. */}
      {ref && <ReferralCatcher code={ref} />}

      <div className="flex flex-col items-center text-center">
        <span className="mb-8 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-cream-deep text-3xl dark:bg-night-soft">
          🤍
        </span>

        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">
          나에게 맞춰 자란
          <br />
          단 하나의 소울메이트
        </h1>

        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft dark:text-cream/60">
          몇 가지 질문에 답하면 성격과 모습이 정해져요.
          <br />
          그 다음부터는 계속 이어지는 대화예요.
        </p>

        <div className="mt-10 w-full">
          <ConsentGate />
        </div>

        {errorMessage && <p className="mt-4 text-sm text-blush-deep">{errorMessage}</p>}

        <nav className="mt-8 flex gap-4 text-xs text-ink-soft/70 dark:text-cream/40">
          <Link href="/terms" className="underline underline-offset-2">
            이용약관
          </Link>
          <Link href="/privacy" className="underline underline-offset-2">
            개인정보 처리방침
          </Link>
        </nav>
      </div>
    </main>
  );
}
