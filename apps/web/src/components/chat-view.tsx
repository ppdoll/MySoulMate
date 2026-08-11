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

/**
 * 대화 화면 — 영상통화 배치.
 *
 * 인물이 화면을 채우고, 주고받은 말은 그 위에 자막처럼 뜬다.
 * 지난 기록은 평소에 숨겨두고 필요할 때만 올린다.
 * 목록형 채팅보다 "지금 마주 보고 있다" 는 느낌이 강해진다.
 */
export function ChatView() {
  const router = useRouter();
  const [soulmate, setSoulmate] = useState<SoulmateResponse | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [expression, setExpression] = useState<Expression>('neutral');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const historyBottomRef = useRef<HTMLDivElement>(null);

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
      if (err instanceof ApiError && err.code === 'unauthorized') return router.replace('/');
      if (err instanceof ApiError && err.code === 'not_found') return router.replace('/onboarding');
      setLoadError(err instanceof Error ? err.message : '불러오지 못했어요.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  // 통화 시간. 이 화면에 머문 시간을 센다.
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (historyOpen) historyBottomRef.current?.scrollIntoView();
  }, [historyOpen]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    setStreaming('');

    const optimistic: ChatMessageDto = {
      id: `local-${Date.now()}`,
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
            ? '오늘 무료 대화를 다 썼어요.'
            : err.message
          : '보내지 못했어요.',
      );
    } finally {
      setSending(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-md px-6 py-12">
        <p className="text-[15px] text-blush-deep">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-full border border-black/10 px-5 py-2 text-sm dark:border-white/15"
        >
          다시 시도
        </button>
      </main>
    );
  }

  if (!soulmate || !wallet) {
    return (
      <main className="mx-auto w-full max-w-md px-6 py-12">
        <p className="text-[15px] text-ink-soft dark:text-cream/60">연결하는 중…</p>
      </main>
    );
  }

  // 화면에는 최근 것만 띄운다. 전체는 기록 패널에서 본다.
  const recent = messages.slice(-2);

  return (
    <main className="relative mx-auto h-dvh w-full max-w-md overflow-hidden bg-night">
      <SoulmateFigure soulmate={soulmate} expression={expression} variant="full" />

      {/* 위아래 그라데이션. 이미지 위 글자가 읽히게 한다. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 via-black/40 to-transparent" />

      {/* 통화 헤더 */}
      <header className="absolute inset-x-0 top-0 flex items-center gap-3 px-5 pt-4 text-white">
        <Link href="/home" aria-label="나가기" className="text-xl leading-none">
          ←
        </Link>
        <div className="min-w-0">
          <p className="truncate font-medium">{soulmate.name}</p>
          <p className="text-xs text-white/70 tabular-nums">
            {formatElapsed(elapsed)}
            {sending && ' · 말하는 중'}
          </p>
        </div>
        <span className="ml-auto rounded-full bg-black/35 px-2.5 py-1 text-xs text-white/90 tabular-nums backdrop-blur-sm">
          {isAdmin ? '무제한' : `남은 ${wallet.freeTurnsRemaining + wallet.balance}`}
        </span>
      </header>

      {/* 자막처럼 뜨는 최근 대화.
          말풍선이 많아져도 헤더를 덮지 않도록 높이를 제한하고 아래쪽에 붙인다. */}
      <div className="absolute inset-x-0 bottom-0 flex max-h-[55%] flex-col justify-end gap-2 overflow-hidden px-5 pb-32">
        {recent.map((m) =>
          m.role === 'assistant' ? (
            splitIntoBubbles(m.content).map((part, i) => (
              <Caption key={`${m.id}-${i}`} role="assistant" text={part} />
            ))
          ) : (
            <Caption key={m.id} role="user" text={m.content} />
          ),
        )}
        {streaming &&
          splitIntoBubbles(streaming).map((part, i) => (
            <Caption key={`s-${i}`} role="assistant" text={part} />
          ))}
        {sending && !streaming && <Caption role="assistant" text="" pending />}
      </div>

      {error && (
        <p className="absolute inset-x-0 bottom-24 px-5 text-center text-sm text-white drop-shadow">
          {error}
        </p>
      )}

      {/* 입력 바 */}
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 px-4 pb-5">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="지난 대화"
          className="h-11 w-11 shrink-0 rounded-full bg-white/15 text-white backdrop-blur-md"
        >
          ☰
        </button>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder={`${soulmate.name}에게 말하기`}
          className="max-h-28 flex-1 resize-none rounded-3xl bg-white/15 px-4 py-3 text-[15px] text-white placeholder:text-white/55 backdrop-blur-md outline-none focus:bg-white/25"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !draft.trim()}
          className="h-11 shrink-0 rounded-full bg-blush px-5 text-sm font-medium text-white disabled:opacity-40"
        >
          보내기
        </button>
      </div>

      {historyOpen && (
        <HistoryPanel
          messages={messages}
          name={soulmate.name}
          onClose={() => setHistoryOpen(false)}
          bottomRef={historyBottomRef}
        />
      )}
    </main>
  );
}

/** 이미지 위에 뜨는 자막형 말풍선. */
function Caption({
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
    <div className={`bubble-pop flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-lg backdrop-blur-md ${
          mine ? 'bg-blush/90 text-white' : 'bg-white/90 text-ink'
        }`}
      >
        {pending ? (
          <span className="dot-blink inline-flex gap-1">
            <span>·</span>
            <span>·</span>
            <span>·</span>
          </span>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

/** 지난 대화 전체. 평소엔 숨어 있다가 올라온다. */
function HistoryPanel({
  messages,
  name,
  onClose,
  bottomRef,
}: {
  messages: ChatMessageDto[];
  name: string;
  onClose: () => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-black/45 backdrop-blur-sm">
      <button type="button" className="flex-1" onClick={onClose} aria-label="닫기" />
      <div className="max-h-[75%] overflow-y-auto rounded-t-3xl bg-cream px-5 pt-4 pb-6 dark:bg-night-soft">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">{name}와 나눈 이야기</span>
          <button type="button" onClick={onClose} className="text-sm text-ink-soft dark:text-cream/60">
            닫기
          </button>
        </div>
        <div className="space-y-2">
          {messages.map((m) =>
            m.role === 'assistant' ? (
              splitIntoBubbles(m.content).map((part, i) => (
                <HistoryBubble key={`${m.id}-${i}`} mine={false} text={part} />
              ))
            ) : (
              <HistoryBubble key={m.id} mine text={m.content} />
            ),
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function HistoryBubble({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          mine ? 'bg-blush text-white' : 'bg-white text-ink dark:bg-white/10 dark:text-cream'
        }`}
      >
        {text}
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * SSE 응답을 이벤트로 쪼갠다.
 *
 * EventSource를 쓸 수 없어서(헤더를 못 붙인다) 직접 읽는다.
 * 청크가 이벤트 경계에서 잘리므로 버퍼에 모아 \n\n 기준으로 나눈다.
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
