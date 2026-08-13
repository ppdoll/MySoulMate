'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ARCHETYPES,
  ONBOARDING_QUESTION_LIST,
  OnboardingAnswersSchema,
  PRESENTATION_META,
  defaultsForArchetype,
  presetImagePath,
  presetsByPresentation,
  vibeForArchetype,
  type ArchetypeValue,
  type OnboardingAnswers,
  type OnboardingQuestion,
  type SoulmateResponse,
} from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';

type Draft = Partial<OnboardingAnswers>;

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = ONBOARDING_QUESTION_LIST[step]!;
  const total = ONBOARDING_QUESTION_LIST.length;
  const answered = useMemo(() => isAnswered(question, draft), [question, draft]);

  function set<K extends keyof OnboardingAnswers>(key: K, value: OnboardingAnswers[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  /**
   * 타입을 고르면 성격 3축 기본값을 함께 채워둔다.
   *
   * 프리셋은 미리 고르지 않는다. 예전에는 타입의 추천 분위기를 그대로 프리셋 ID 로
   * 썼는데, 남성 캐릭터가 생긴 뒤로 그렇게 하면 성별 표현까지 대신 정해버린다.
   * 추천은 프리셋 화면에서 표시만 하고 고르는 건 사용자가 한다.
   */
  function pickArchetype(value: ArchetypeValue) {
    setDraft((prev) => ({
      ...prev,
      archetype: value,
      ...defaultsForArchetype(value),
    }));
    next();
  }

  function next() {
    setError(null);
    setStep((s) => Math.min(s + 1, total - 1));
  }

  function back() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    const parsed = OnboardingAnswersSchema.safeParse(draft);
    if (!parsed.success) {
      setError('답하지 않은 항목이 있어요. 이전 단계를 확인해 주세요.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<SoulmateResponse>('/onboarding', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      router.replace('/home');
      router.refresh();
    } catch (err) {
      setSubmitting(false);
      setError(messageFor(err));
    }
  }

  if (submitting) return <Generating name={draft.callName ?? ''} />;

  const isLast = step === total - 1;

  return (
    <main className="safe-page mx-auto flex min-h-dvh w-full max-w-md flex-col px-6">
      <Progress current={step + 1} total={total} />

      <div className="mt-8 flex-1">
        <h2 className="text-xl leading-snug font-semibold">{question.title}</h2>
        {question.help && (
          <p className="mt-2 text-sm text-ink-soft dark:text-cream/60">{question.help}</p>
        )}

        <div className="mt-6">
          <Field question={question} draft={draft} set={set} pickArchetype={pickArchetype} />
        </div>

        {error && <p className="mt-5 text-sm text-blush-deep">{error}</p>}
      </div>

      <div className="mt-8 flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={back}
            className="rounded-full border border-black/10 px-5 py-3 text-sm dark:border-white/15"
          >
            이전
          </button>
        )}
        {/* 카드형 선택은 고르는 즉시 넘어가므로 다음 버튼을 두지 않는다. */}
        {question.type !== 'archetype' && (
          <button
            type="button"
            onClick={isLast ? () => void submit() : next}
            disabled={!answered}
            className="flex-1 rounded-full bg-blush px-6 py-3 text-sm font-medium text-white transition disabled:opacity-40"
          >
            {isLast ? '만들기' : '다음'}
          </button>
        )}
      </div>
    </main>
  );
}

function Field({
  question,
  draft,
  set,
  pickArchetype,
}: {
  question: OnboardingQuestion;
  draft: Draft;
  set: <K extends keyof OnboardingAnswers>(k: K, v: OnboardingAnswers[K]) => void;
  pickArchetype: (v: ArchetypeValue) => void;
}) {
  switch (question.type) {
    case 'archetype':
      return (
        <div className="flex flex-col gap-3">
          {ARCHETYPES.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => pickArchetype(a.value)}
              className={`rounded-2xl border p-4 text-left transition ${
                draft.archetype === a.value
                  ? 'border-blush bg-blush/5'
                  : 'border-black/10 hover:border-blush/50 dark:border-white/15'
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="text-lg">{a.emoji}</span>
                <span className="font-semibold">{a.label}</span>
                <span className="text-sm text-ink-soft dark:text-cream/60">{a.tagline}</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft dark:text-cream/60">
                {a.description}
              </p>
            </button>
          ))}
        </div>
      );

    case 'preset': {
      // 타입에서 온 추천 분위기. 고르라고 강요하지 않고 표시만 한다 —
      // 미리 선택해두면 성별 표현까지 대신 정해버리게 된다.
      const recommended = draft.archetype ? vibeForArchetype(draft.archetype) : null;

      return (
        <div className="space-y-6">
          {presetsByPresentation().map((group) => (
            <div key={group.presentation}>
              <p className="mb-2 text-xs text-ink-soft dark:text-cream/50">
                {PRESENTATION_META[group.presentation].label}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {group.characters.map((p) => {
                  const on = draft.presetId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set('presetId', p.id)}
                      className={`overflow-hidden rounded-2xl border text-left transition ${
                        on
                          ? 'border-blush ring-2 ring-blush/30'
                          : 'border-black/10 dark:border-white/15'
                      }`}
                    >
                      {/* 이미지가 아직 없어도 자리와 라벨은 보이게 둔다. */}
                      <span className="flex aspect-square w-full items-center justify-center bg-cream-deep dark:bg-night-soft">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={presetImagePath(p.id, 'neutral')}
                          alt={p.label}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </span>
                      <span className="block px-3 py-2">
                        <span className="block text-sm font-medium">
                          {p.label}
                          {recommended === p.vibe && (
                            <span className="ml-1.5 text-[11px] font-normal text-blush-deep">
                              추천
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-ink-soft dark:text-cream/60">
                          {p.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      );
    }

    case 'single': {
      const key = question.key as 'tone' | 'speechStyle';
      return (
        <div className="flex flex-col gap-2.5">
          {question.options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => set(key, o.value as never)}
              className={`rounded-xl border p-4 text-left transition ${
                draft[key] === o.value
                  ? 'border-blush bg-blush/5'
                  : 'border-black/10 hover:border-blush/50 dark:border-white/15'
              }`}
            >
              <div className="font-medium">{o.label}</div>
              {o.description && (
                <div className="mt-0.5 text-sm text-ink-soft dark:text-cream/60">
                  {o.description}
                </div>
              )}
            </button>
          ))}
        </div>
      );
    }

    case 'multi': {
      const selected = draft.interests ?? [];
      return (
        <div className="flex flex-wrap gap-2">
          {question.options.map((o) => {
            const on = selected.includes(o.value as never);
            const full = selected.length >= question.max && !on;
            return (
              <button
                key={o.value}
                type="button"
                disabled={full}
                onClick={() =>
                  set(
                    'interests',
                    (on
                      ? selected.filter((v) => v !== o.value)
                      : [...selected, o.value]) as OnboardingAnswers['interests'],
                  )
                }
                className={`rounded-full border px-4 py-2 text-sm transition ${
                  on
                    ? 'border-blush bg-blush text-white'
                    : 'border-black/10 disabled:opacity-35 dark:border-white/15'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }

    case 'scale': {
      const key = question.key as 'energy' | 'thinking' | 'humor';
      const value = draft[key] ?? 3;
      return (
        <div>
          <div className="flex justify-between text-xs text-ink-soft dark:text-cream/60">
            <span>{question.minLabel}</span>
            <span>{question.maxLabel}</span>
          </div>
          <div className="mt-3 flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => set(key, n)}
                aria-label={`${n} / 5`}
                className={`h-12 flex-1 rounded-xl border text-sm font-medium transition ${
                  value === n
                    ? 'border-blush bg-blush text-white'
                    : 'border-black/10 hover:border-blush/50 dark:border-white/15'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-soft/70 dark:text-cream/40">
            고르신 타입에 맞춰 미리 채워뒀어요. 그대로 두셔도 됩니다.
          </p>
        </div>
      );
    }

    case 'text': {
      const key = question.key as 'callName';
      return (
        <textarea
          value={draft[key] ?? ''}
          onChange={(e) => set(key, e.target.value)}
          placeholder={question.placeholder}
          maxLength={question.maxLength}
          rows={key === 'callName' ? 1 : 3}
          className="w-full resize-none rounded-xl border border-black/10 bg-white px-4 py-3 text-[15px] outline-none focus:border-blush dark:border-white/15 dark:bg-night-soft"
        />
      );
    }
  }
}

function Progress({ current, total }: { current: number; total: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-soft dark:text-cream/50">
        <span>소울메이트 만들기</span>
        <span className="tabular-nums">
          {current} / {total}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-cream-deep dark:bg-night-soft">
        <div
          className="h-full rounded-full bg-blush transition-all duration-300"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Generating({ name }: { name: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="h-14 w-14 animate-pulse rounded-full bg-blush/30" />
      <h2 className="mt-8 text-lg font-semibold">
        {name ? `${name}를 만들고 있어요` : '만들고 있어요'}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft dark:text-cream/60">
        성격을 정하고 모습을 그리는 중이에요.
        <br />
        30초 정도 걸릴 수 있어요.
      </p>
    </main>
  );
}

function isAnswered(question: OnboardingQuestion, draft: Draft): boolean {
  switch (question.type) {
    case 'archetype':
      return Boolean(draft.archetype);
    case 'preset':
      return Boolean(draft.presetId);
    case 'multi':
      return (draft.interests?.length ?? 0) >= question.min;
    case 'scale':
      return draft[question.key as 'energy' | 'thinking' | 'humor'] !== undefined;
    case 'single':
      return Boolean(draft[question.key as 'tone' | 'speechStyle']);
    case 'text':
      return question.optional ? true : Boolean(draft[question.key as 'callName']?.trim());
  }
}

function messageFor(err: unknown): string {
  if (!(err instanceof ApiError)) return '만들지 못했어요. 잠시 후 다시 시도해 주세요.';
  switch (err.code) {
    case 'model_rate_limited':
      return `지금 요청이 몰려 있어요. ${err.retryAfterSeconds ?? 30}초 뒤에 다시 시도해 주세요.`;
    case 'content_blocked':
      return err.message;
    case 'already_claimed':
      return '이미 소울메이트가 있어요.';
    default:
      return err.message;
  }
}
