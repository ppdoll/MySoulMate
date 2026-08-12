'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MEMORY_KINDS,
  MEMORY_KIND_HINT,
  type MemoryDto,
  type MemoryKind,
  type MemoryListResponse,
} from '@mysoulmate/shared';
import { ApiError, apiFetch } from '@/lib/api';

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: '사실',
  event: '예정',
  concern: '고민',
  preference: '취향',
};

/**
 * 기억 관리.
 *
 * 필요한 이유는 하나다. 모델이 넣은 기억은 낡는다.
 * "금요일에 발표가 있다" 는 발표가 끝나도 남아서 다음 주에도 물어본다.
 * 지우는 버튼이 없으면 대화로는 못 지운다.
 */
export function MemoriesView() {
  const router = useRouter();
  const [data, setData] = useState<MemoryListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiFetch<MemoryListResponse>('/memories'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthorized') {
        router.replace('/');
        return;
      }
      if (err instanceof ApiError && err.code === 'not_found') {
        router.replace('/home');
        return;
      }
      setError(err instanceof Error ? err.message : '불러오지 못했어요.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  function replace(next: MemoryDto) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            memories: prev.memories.map((m) => (m.id === next.id ? next : m)),
            pinnedCount: prev.memories.filter((m) =>
              m.id === next.id ? next.pinned : m.pinned,
            ).length,
          }
        : prev,
    );
  }

  function drop(id: string) {
    setData((prev) => {
      if (!prev) return prev;
      const memories = prev.memories.filter((m) => m.id !== id);
      return { ...prev, memories, pinnedCount: memories.filter((m) => m.pinned).length };
    });
  }

  return (
    <main className="mx-auto w-full max-w-md px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">기억</h1>
        <Link
          href="/home"
          className="text-sm text-ink-soft underline-offset-4 hover:underline dark:text-cream/50"
        >
          닫기
        </Link>
      </header>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft dark:text-cream/60">
        대화에서 알게 된 것들이에요. 지난 일이 남아 있으면 지워주세요.
        고정한 기억은 지워지지 않고 항상 먼저 떠올려요.
      </p>

      {error && (
        <div className="mt-6">
          <p className="text-[15px] text-blush-deep">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-full border border-black/10 px-5 py-2 text-sm dark:border-white/15"
          >
            다시 시도
          </button>
        </div>
      )}

      {!data && !error && (
        <p className="mt-8 text-[15px] text-ink-soft dark:text-cream/60">불러오는 중…</p>
      )}

      {data && (
        <>
          <div className="mt-6 flex items-baseline justify-between text-xs text-ink-soft dark:text-cream/50">
            <span>
              고정 {data.pinnedCount} / {data.pinLimit}
            </span>
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-sm text-blush-deep underline-offset-4 hover:underline"
            >
              {adding ? '취소' : '직접 추가'}
            </button>
          </div>

          {adding && (
            <AddMemory
              onAdded={(created) => {
                setData((prev) =>
                  prev
                    ? {
                        ...prev,
                        memories: [created, ...prev.memories],
                        pinnedCount: prev.pinnedCount + (created.pinned ? 1 : 0),
                      }
                    : prev,
                );
                setAdding(false);
              }}
            />
          )}

          {data.memories.length === 0 ? (
            <p className="mt-8 rounded-2xl border border-dashed border-black/15 p-6 text-center text-[15px] text-ink-soft dark:border-white/15 dark:text-cream/60">
              아직 기억이 없어요.
              <br />
              대화가 쌓이면 알아서 생겨요.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.memories.map((memory) => (
                <MemoryRow
                  key={memory.id}
                  memory={memory}
                  onChanged={replace}
                  onDeleted={() => drop(memory.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}

function MemoryRow({
  memory,
  onChanged,
  onDeleted,
}: {
  memory: MemoryDto;
  onChanged: (next: MemoryDto) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await apiFetch<MemoryDto>(`/memories/${memory.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      );
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>(`/memories/${memory.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했어요.');
      setBusy(false);
    }
  }

  return (
    <li
      className={`rounded-2xl border p-4 ${
        memory.pinned ? 'border-blush/40 bg-blush/5' : 'border-black/10 dark:border-white/15'
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-ink-soft dark:text-cream/50">
        <span className="rounded-full bg-black/5 px-2 py-0.5 dark:bg-white/10">
          {KIND_LABEL[memory.kind] ?? memory.kind}
        </span>
        {memory.pinned && <span className="text-blush-deep">고정됨</span>}
        <span className="ml-auto tabular-nums">{formatDate(memory.createdAt)}</span>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, 200))}
          rows={2}
          className="mt-2 w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2 text-[15px] outline-none focus:border-blush dark:border-white/15 dark:bg-night-soft"
        />
      ) : (
        <p className="mt-2 text-[15px] leading-relaxed">{memory.content}</p>
      )}

      {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}

      <div className="mt-3 flex gap-3 text-sm text-ink-soft dark:text-cream/60">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(memory.content);
                setEditing(false);
              }}
            >
              취소
            </button>
            <button
              type="button"
              disabled={busy || !draft.trim() || draft.trim() === memory.content}
              onClick={() => void patch({ content: draft.trim() })}
              className="font-medium text-blush-deep disabled:opacity-40"
            >
              저장
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => setEditing(true)}>
              고치기
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch({ pinned: !memory.pinned })}
            >
              {memory.pinned ? '고정 해제' : '고정'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="ml-auto text-blush-deep"
            >
              지우기
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function AddMemory({ onAdded }: { onAdded: (created: MemoryDto) => void }) {
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onAdded(
        await apiFetch<MemoryDto>('/memories', {
          method: 'POST',
          body: JSON.stringify({ kind, content: content.trim() }),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '추가하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-blush/40 p-4">
      <div className="flex flex-wrap gap-1.5">
        {MEMORY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            title={MEMORY_KIND_HINT[k]}
            className={`rounded-full px-3 py-1 text-xs ${
              kind === k
                ? 'bg-blush text-white'
                : 'bg-black/5 text-ink-soft dark:bg-white/10 dark:text-cream/60'
            }`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value.slice(0, 200))}
        rows={2}
        placeholder="한 문장으로 적어주세요"
        className="mt-3 w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2 text-[15px] outline-none focus:border-blush dark:border-white/15 dark:bg-night-soft"
      />

      {error && <p className="mt-2 text-sm text-blush-deep">{error}</p>}

      <button
        type="button"
        disabled={busy || !content.trim()}
        onClick={() => void submit()}
        className="mt-2 w-full rounded-full bg-blush px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? '추가 중…' : '추가하고 고정'}
      </button>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(date);
}
