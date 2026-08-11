'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  parseEmotionTag,
  splitIntoBubbles,
  type ChatHistoryResponse,
  type ChatMessageDto,
  type ChatStreamEvent,
  type Expression,
  type MeResponse,
  type SoulmateResponse,
  type WalletState,
} from '@mysoulmate/shared';
import { ApiError, apiFetch, apiStream } from '@/lib/api';
import { SoulmateFigure } from './soulmate-figure';

export function ChatView() {
  const router = useRouter();
  const [soulmate, setSoulmate] = useState<SoulmateResponse | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  /** 스트리밍 중인 응답. 확정되면 messages 로 옮긴다. 감정 태그는 떼어낸 상태다. */
  const [streaming, setStreaming] = useState('');
  /** 지금 지어야 할 표정. 응답 첫 조각의 태그로 정해지므로 글자보다 먼저 바뀐다. */
  const [expression, setExpression] = useState<Expression>('neutral');
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
    let body = '';
    try {
      const res = await apiStream('/chat', { text });
      for await (const event of readSse(res)) {
        if (event.type === 'delta') {
          accumulated += event.text;
          // 태그는 맨 앞에 오므로 매 조각마다 다시 떼어낸다.
          // 첫 조각에서 표정이 정해지고, 이후로는 같은 결과가 나온다.
          const parsed = parseEmotionTag(accumulated);
          setExpression(parsed.expression);
          body = parsed.rest;
          setStreaming(body);
        } else if (event.type === 'done') {
          setMessages((prev) => [
            ...prev,
            {
              id: event.messageId,
              role: 'assistant',
              content: body || accumulated,
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
      setExpression('worried');
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
        <span className="font-medium">{soulmate.name}</span>
        <span className="ml-auto text-xs text-ink-soft tabular-nums dark:text-cream/50">
          {isAdmin ? '무제한' : `남은 ${wallet.freeTurnsRemaining + wallet.balance}`}
        </span>
      </header>

      {/* 표정은 응답 첫 조각에서 정해지므로 글자보다 먼저 바뀐다. */}
      <div className="shrink-0 px-5 pt-4 pb-1">
        <SoulmateFigure soulmate={soulmate} expression={expression} speaking={sending} />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
        {messages.map((m) =>
          // AI 응답은 여러 말풍선으로 나눠 그린다. 사람이 메신저에서 그러듯이.
          // 분할 결과가 항상 같으므로 실시간이든 기록이든 동일하게 보인다.
          m.role === 'assistant' ? (
            splitIntoBubbles(m.content).map((part, i) => (
              <Bubble key={`${m.id}-${i}`} role="assistant" text={part} />
            ))
          ) : (
            <Bubble key={m.id} role="user" text={m.content} />
          ),
        )}
        {streaming &&
          splitIntoBubbles(streaming).map((part, i) => (
            <Bubble key={`streaming-${i}`} role="assistant" text={part} />
          ))}
        {sending && !streaming && <Bubble role="assistant" text="" pending />}
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

/**
 * 만화풍 말풍선.
 *
 * 꼬리는 회전시킨 정사각형으로 만든다. CSS 삼각형(border 트릭)은 배경색만 되고
 * 테두리를 못 그려서, 테두리가 있는 말풍선에는 맞지 않는다.
 */
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

  const skin = mine
    ? 'bg-blush text-white border-blush'
    : 'bg-white text-ink border-black/10 dark:bg-night-soft dark:text-cream dark:border-white/15';

  return (
    <div className={`bubble-pop flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative max-w-[80%] rounded-2xl border px-4 py-2.5 ${skin}`}>
        <span className="block text-[15px] leading-relaxed whitespace-pre-wrap">
          {pending ? (
            <span className="dot-blink inline-flex gap-1">
              <span>·</span>
              <span>·</span>
              <span>·</span>
            </span>
          ) : (
            text
          )}
        </span>

        {/* 꼬리: 같은 배경/테두리의 사각형을 45도 돌려 모서리만 삐져나오게 한다. */}
        <span
          aria-hidden
          className={`absolute top-3 h-3 w-3 rotate-45 border ${skin} ${
            mine ? '-right-[7px] border-t-0 border-l-0' : '-left-[7px] border-r-0 border-b-0'
          }`}
        />
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
