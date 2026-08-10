'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  ChatHistoryResponse,
  ChatMessageDto,
  ChatStreamEvent,
  MeResponse,
  SoulmateResponse,
  WalletState,
} from '@mysoulmate/shared';
import { ApiError, apiFetch, apiStream } from '@/lib/api';

export function ChatView() {
  const router = useRouter();
  const [soulmate, setSoulmate] = useState<SoulmateResponse | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  /** 스트리밍 중인 응답. 확정되면 messages 로 옮긴다. */
  const [streaming, setStreaming] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [me, sm, history] = await Promise.all([
        apiFetch<MeResponse>('/me'),
        apiFetch<SoulmateResponse>('/soulmate'),
        apiFetch<ChatHistoryResponse>('/chat/messages'),
      ]);
      setWallet(me.wallet);
      setIsAdmin(me.isAdmin);
      setSoulmate(sm);
      setMessages(history.messages);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthorized') {
        router.replace('/');
        return;
      }
      if (err instanceof ApiError && err.code === 'not_found') {
        router.replace('/onboarding');
        return;
      }
      setLoadError(err instanceof Error ? err.message : '불러오지 못했어요.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    setStreaming('');

    // 낙관적으로 먼저 그린다. 실패하면 되돌리고 입력창에 되살린다.
    const optimistic: ChatMessageDto = {
      id: `local-${messages.length}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');

    let accumulated = '';
    try {
      const res = await apiStream('/chat', { text });
      for await (const event of readSse(res)) {
        if (event.type === 'delta') {
          accumulated += event.text;
          setStreaming(accumulated);
        } else if (event.type === 'done') {
          setMessages((prev) => [
            ...prev,
            {
              id: event.messageId,
              role: 'assistant',
              content: accumulated,
              createdAt: new Date().toISOString(),
            },
          ]);
          setWallet(event.wallet);
          setStreaming('');
        } else {
          throw new ApiError(event.code, event.message, 400, event.retryAfterSeconds);
        }
      }
    } catch (err) {
      // 보낸 메시지를 지우고 입력창에 돌려놓는다. 다시 타이핑하게 만들지 않는다.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setStreaming('');
      setError(
        err instanceof ApiError
          ? err.code === 'insufficient_credits'
            ? '오늘 무료 대화를 다 썼어요. 크레딧을 충전하면 이어갈 수 있어요.'
            : err.message
          : '보내지 못했어요.',
      );
    } finally {
      setSending(false);
    }
  }

  if (loadError) {
    return (
      <Shell>
        <p className="text-[15px] text-blush-deep">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-full border border-black/10 px-5 py-2 text-sm dark:border-white/15"
        >
          다시 시도
        </button>
      </Shell>
    );
  }

  if (!soulmate || !wallet) {
    return (
      <Shell>
        <p className="text-[15px] text-ink-soft dark:text-cream/60">불러오는 중…</p>
      </Shell>
    );
  }

  const exhausted = !isAdmin && wallet.freeTurnsRemaining === 0 && wallet.balance === 0;

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <header className="flex items-center gap-3 border-b border-black/5 px-5 py-3 dark:border-white/10">
        <Link href="/home" className="text-ink-soft dark:text-cream/50" aria-label="뒤로">
          ←
        </Link>
        {soulmate.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={soulmate.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cream-deep text-sm dark:bg-night-soft">
            🤍
          </span>
        )}
        <span className="font-medium">{soulmate.name}</span>
        <span className="ml-auto text-xs text-ink-soft tabular-nums dark:text-cream/50">
          {isAdmin ? '무제한' : `남은 ${wallet.freeTurnsRemaining + wallet.balance}`}
        </span>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} text={m.content} />
        ))}
        {streaming && <Bubble role="assistant" text={streaming} />}
        {sending && !streaming && (
          <Bubble role="assistant" text="" pending />
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-5 pb-2 text-sm text-blush-deep">
          {error}
          {exhausted && (
            <Link href="/home" className="ml-2 underline underline-offset-4">
              충전하러 가기
            </Link>
          )}
        </p>
      )}

      <div className="flex items-end gap-2 border-t border-black/5 px-5 py-3 dark:border-white/10">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 모바일에서는 줄바꿈이 더 자연스러우므로 Enter 전송은 데스크톱에서만.
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder={`${soulmate.name}에게 말 걸기`}
          className="max-h-32 flex-1 resize-none rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-[15px] outline-none focus:border-blush dark:border-white/15 dark:bg-night-soft"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          className="h-10 shrink-0 rounded-full bg-blush px-5 text-sm font-medium text-white disabled:opacity-40"
        >
          보내기
        </button>
      </div>
    </div>
  );
}

function Bubble({
  role,
  text,
  pending,
}: {
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}) {
  const mine = role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
          mine
            ? 'bg-blush text-white'
            : 'bg-cream-deep text-ink dark:bg-night-soft dark:text-cream'
        }`}
      >
        {pending ? <span className="opacity-50">…</span> : text}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-md px-6 py-12">{children}</main>;
}

/**
 * SSE 응답을 이벤트로 쪼갠다.
 *
 * EventSource를 쓸 수 없어서(헤더를 못 붙인다) 직접 읽는다.
 * 청크가 이벤트 경계에서 잘리지 않으므로 버퍼에 모아 \n\n 기준으로 나눈다.
 */
async function* readSse(res: Response): AsyncGenerator<ChatStreamEvent> {
  const reader = res.body?.getReader();
  if (!reader) throw new ApiError('internal_error', '응답을 읽지 못했어요.', 500);

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      if (!raw.startsWith('data:')) continue;
      try {
        yield JSON.parse(raw.slice(5).trim()) as ChatStreamEvent;
      } catch {
        // 깨진 조각은 버린다. 다음 이벤트가 정상이면 계속 진행한다.
      }
    }
  }
}
