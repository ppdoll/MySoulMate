import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  CREDIT_COSTS,
  CompressionSchema,
  MEMORY_RECALL_LIMIT,
  MEMORY_STORE_LIMIT,
  PersonaSchema,
  parseEmotionTag,
  type MemoryItem,
  type ChatHistoryResponse,
  type ChatMessageDto,
  type ChatStreamEvent,
  type RelationshipTone,
} from '@mysoulmate/shared';
import { SupabaseService } from '../supabase/supabase.module';
import { CreditsService } from '../credits/credits.service';
import { GeminiService } from '../ai/gemini.service';
import { ApiException } from '../common/api-exception';
import { ModelBlockedError, ModelRateLimitedError } from '../ai/errors';
import type { AuthUser } from '../auth/current-user.decorator';
import { COMPRESSION_SYSTEM_PROMPT, buildChatSystemPrompt, buildTimeContext } from './prompt';

/** 원문 그대로 모델에 넘길 최근 메시지 수. 늘리면 매 턴 입력 토큰이 그만큼 늘어난다. */
const CONTEXT_MESSAGES = 20;

/** 요약하지 않은 메시지가 이만큼 쌓이면 오래된 쪽을 압축한다. */
const SUMMARY_THRESHOLD = 40;

/** 한 번 요약할 때 압축하는 메시지 수. */
const SUMMARY_BATCH = 20;

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  /** 삽입 순서. created_at 은 한 번의 INSERT 안에서 동일해 정렬 기준이 될 수 없다. */
  seq: number;
  emotion: string | null;
}

interface ConversationContext {
  soulmateId: string;
  conversationId: string;
  persona: z.infer<typeof PersonaSchema>;
  tone: RelationshipTone;
  summary: string;
  /** 사용자를 부를 이름. 구글 프로필에서 온다. */
  userName: string | null;
  /** 마지막 메시지 시각. 공백을 계산해 프롬프트에 넣는다. */
  lastMessageAt: Date | null;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly credits: CreditsService,
    private readonly gemini: GeminiService,
  ) {}

  /**
   * 한 턴의 대화를 처리한다.
   *
   * 크레딧을 먼저 차감하고 실패하면 되돌린다. 반대 순서면 스트림만 받고
   * 연결을 끊어 공짜로 쓸 수 있다.
   *
   * 메시지는 응답이 끝난 뒤 사용자/AI 것을 한 번에 저장한다.
   * 미리 넣으면 실패했을 때 답 없는 사용자 메시지가 기록에 남는다.
   */
  async *stream(user: AuthUser, text: string): AsyncGenerator<ChatStreamEvent> {
    const ctx = await this.loadContext(user.id);

    const spend = await this.credits.spend({
      userId: user.id,
      amount: CREDIT_COSTS.chatTurn,
      reason: 'chat_spend',
      // 표시용 잔여를 계산하는 값과 반드시 같아야 한다.
      // 어긋나면 "남은 5" 인데 차감이 거절되는 식이 된다.
      freeAllowance: this.credits.freeDailyChatTurns,
      refType: 'conversation',
      refId: ctx.conversationId,
      unlimited: user.isAdmin,
    });

    let answer = '';
    try {
      // 임계치를 넘었으면 여기서 한 번 압축한다(요약 + 기억 추출).
      // 20턴에 한 번 이 턴만 조금 느려지고, 이후 입력 토큰이 다시 줄어든다.
      const summary = await this.maybeCompress(ctx);

      const [history, memories] = await Promise.all([
        this.recentMessages(ctx.conversationId, CONTEXT_MESSAGES),
        this.recallMemories(ctx.soulmateId),
      ]);

      const system = buildChatSystemPrompt({
        persona: ctx.persona,
        tone: ctx.tone,
        summary,
        userName: ctx.userName,
        timeContext: buildTimeContext(new Date(), ctx.lastMessageAt),
        memories,
      });

      for await (const delta of this.gemini.streamChat({
        system,
        messages: [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: text },
        ],
      })) {
        answer += delta;
        yield { type: 'delta', text: delta };
      }

      if (!answer.trim()) {
        throw new ModelBlockedError('빈 응답');
      }

      // 태그 자체는 본문에서 떼어낸다. 남겨두면 다음 턴 컨텍스트에 섞이고 화면에도 보인다.
      // 다만 어떤 감정이었는지는 컬럼으로 저장한다 — 나중에 기록을 다시 그릴 때
      // 강조 색을 입히려면 필요하다.
      const { rest, expression } = parseEmotionTag(answer);
      const messageId = await this.persistTurn(
        ctx.conversationId,
        text,
        rest.trim() || answer,
        expression,
      );
      const wallet = await this.credits.getWallet(user.id);
      yield { type: 'done', messageId, wallet, emotion: expression };
    } catch (err) {
      await this.credits.refund({
        userId: user.id,
        freeUsed: spend.freeUsed,
        paidUsed: spend.paidUsed,
        refType: 'conversation',
        refId: ctx.conversationId,
      });

      const failure = this.toStreamError(err);
      // 이미 일부가 흘러간 경우 프론트는 그 조각을 버리고 오류를 보여준다.
      yield failure;
    }
  }

  async history(userId: string, before?: string): Promise<ChatHistoryResponse> {
    const ctx = await this.loadContext(userId);

    let query = this.supabase.client
      .from('messages')
      .select('id, role, content, created_at, seq, emotion')
      .eq('conversation_id', ctx.conversationId)
      .order('seq', { ascending: false })
      .limit(CONTEXT_MESSAGES + 1);

    // 커서는 seq 값이다. 시각으로 나누면 같은 순간에 저장된 메시지에서
    // 누락이나 중복이 생긴다.
    const cursor = before ? Number.parseInt(before, 10) : Number.NaN;
    if (Number.isFinite(cursor)) query = query.lt('seq', cursor);

    const { data, error } = await query;
    if (error) {
      this.logger.error(`대화 기록 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const rows = (data ?? []) as MessageRow[];
    const hasMore = rows.length > CONTEXT_MESSAGES;
    const page = hasMore ? rows.slice(0, CONTEXT_MESSAGES) : rows;
    const oldest = page[page.length - 1];

    return {
      // 조회는 최신순이지만 화면은 오래된 것부터 그린다.
      messages: page.slice().reverse().map(toDto),
      hasMore,
      nextCursor: hasMore && oldest ? String(oldest.seq) : null,
    };
  }

  private async loadContext(userId: string): Promise<ConversationContext> {
    const { data, error } = await this.supabase.client
      .from('soulmates')
      .select('id, tone, persona, conversations(id, summary), profiles!inner(display_name)')
      .eq('user_id', userId)
      .maybeSingle<{
        id: string;
        tone: RelationshipTone;
        persona: unknown;
        conversations: { id: string; summary: string }[] | null;
        profiles: { display_name: string | null } | null;
      }>();

    if (error) {
      this.logger.error(`대화 컨텍스트 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    if (!data) throw ApiException.notFound('소울메이트가 아직 없어요.');

    const conversation = data.conversations?.[0];
    if (!conversation) {
      // create_soulmate 가 대화 스레드까지 만든다. 없다면 데이터가 깨진 것이다.
      this.logger.error(`대화 스레드가 없습니다. soulmate=${data.id}`);
      throw ApiException.internal();
    }

    return {
      soulmateId: data.id,
      conversationId: conversation.id,
      persona: PersonaSchema.parse(data.persona),
      tone: data.tone,
      summary: conversation.summary ?? '',
      userName: data.profiles?.display_name ?? null,
      lastMessageAt: await this.lastMessageAt(conversation.id),
    };
  }

  private async lastMessageAt(conversationId: string): Promise<Date | null> {
    const { data, error } = await this.supabase.client
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>();

    if (error || !data) return null;
    const parsed = new Date(data.created_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async recentMessages(conversationId: string, limit: number): Promise<MessageRow[]> {
    const { data, error } = await this.supabase.client
      .from('messages')
      .select('id, role, content, created_at, seq, emotion')
      .eq('conversation_id', conversationId)
      .order('seq', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`최근 메시지 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    return ((data ?? []) as MessageRow[]).reverse();
  }

  /**
   * 사용자 메시지와 응답을 한 번에 넣는다. 하나의 INSERT 라 둘 중 하나만 남는 일이 없다.
   *
   * 배열 순서대로 seq 가 매겨지므로 질문이 먼저, 응답이 나중이 된다.
   * created_at 은 두 행이 동일하다(now() 는 트랜잭션 시작 시각) — 정렬에 쓰면 안 된다.
   */
  private async persistTurn(
    conversationId: string,
    userText: string,
    answer: string,
    emotion: string,
  ): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('messages')
      .insert([
        { conversation_id: conversationId, role: 'user', content: userText, emotion: null },
        { conversation_id: conversationId, role: 'assistant', content: answer, emotion },
      ])
      .select('id, role');

    if (error) {
      this.logger.error(`메시지 저장 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const assistant = (data ?? []).find((r: { role: string }) => r.role === 'assistant');
    return (assistant as { id: string } | undefined)?.id ?? '';
  }

  /**
   * 프롬프트에 넣을 기억.
   *
   * 중요한 것부터, 같은 중요도면 최근 것부터 가져온다.
   * pgvector 로 관련성 검색을 하는 건 다음 단계다 — 기억이 수십 개 수준이면
   * 전부 넣는 것과 골라 넣는 것의 차이가 크지 않다.
   */
  private async recallMemories(
    soulmateId: string,
  ): Promise<{ kind: string; content: string }[]> {
    const { data, error } = await this.supabase.client
      .from('memories')
      .select('kind, content')
      .eq('soulmate_id', soulmateId)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(MEMORY_RECALL_LIMIT);

    if (error) {
      // 기억을 못 불러와도 대화는 되어야 한다.
      this.logger.warn(`기억 조회 실패 [${error.code}] ${error.message}`);
      return [];
    }
    return (data ?? []) as { kind: string; content: string }[];
  }

  /**
   * 요약이 필요하면 만들고, 아니면 기존 요약을 그대로 돌려준다.
   *
   * 같은 호출에서 기억도 함께 추출한다. 창에서 밀려나는 메시지를 읽는 건
   * 두 작업이 같으므로, 따로 부르면 같은 입력을 두 번 읽히게 된다.
   *
   * 오래된 메시지를 지우지는 않는다 — 기록은 사용자의 것이고,
   * 컨텍스트에 넣지 않을 뿐이다.
   */
  private async maybeCompress(ctx: ConversationContext): Promise<string> {
    const { count, error } = await this.supabase.client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', ctx.conversationId);

    if (error || (count ?? 0) <= SUMMARY_THRESHOLD) return ctx.summary;

    const { data, error: fetchError } = await this.supabase.client
      .from('messages')
      .select('role, content')
      .eq('conversation_id', ctx.conversationId)
      .order('seq', { ascending: true })
      .limit(SUMMARY_BATCH);

    if (fetchError || !data?.length) return ctx.summary;

    const transcript = (data as { role: string; content: string }[])
      .map((m) => `${m.role === 'user' ? '사용자' : ctx.persona.name}: ${m.content}`)
      .join('\n');

    // 이미 아는 것을 함께 넘겨 중복을 막는다.
    const known = await this.recallMemories(ctx.soulmateId);

    try {
      const result = await this.gemini.generateJson({
        system: COMPRESSION_SYSTEM_PROMPT,
        prompt: [
          ctx.summary ? `# 기존 요약\n${ctx.summary}` : '',
          known.length ? `# 이미 알고 있는 것\n${known.map((m) => `- ${m.content}`).join('\n')}` : '',
          `# 정리할 대화\n${transcript}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        schema: CompressionSchema,
        retries: 0,
      });

      await this.supabase.client
        .from('conversations')
        .update({ summary: result.summary })
        .eq('id', ctx.conversationId);

      await this.storeMemories(ctx.soulmateId, result.memories);

      return result.summary;
    } catch (err) {
      // 압축 실패로 대화 자체를 막을 이유는 없다. 기존 요약으로 계속 간다.
      this.logger.warn(
        `압축 실패, 기존 요약 유지: ${err instanceof Error ? err.message : String(err)}`,
      );
      return ctx.summary;
    }
  }

  /**
   * 추출한 기억을 저장하고 오래된 것을 정리한다.
   *
   * 상한을 두는 이유: 지난 일("발표가 있다" -> 이미 끝남)이 계속 쌓이면
   * 프롬프트가 낡은 사실로 채워진다. 지금은 오래된 것부터 밀어내는 방식으로만 처리한다.
   * (끝난 일을 알아보고 지우는 건 다음 단계다)
   */
  private async storeMemories(soulmateId: string, items: MemoryItem[]): Promise<void> {
    if (items.length === 0) return;

    const { error } = await this.supabase.client.from('memories').insert(
      items.map((m) => ({
        soulmate_id: soulmateId,
        kind: m.kind,
        content: m.content,
        importance: m.importance,
      })),
    );

    if (error) {
      this.logger.warn(`기억 저장 실패 [${error.code}] ${error.message}`);
      return;
    }
    this.logger.log(`기억 ${items.length}건 저장 (soulmate=${soulmateId})`);

    const { error: pruneError } = await this.supabase.client.rpc('prune_memories', {
      p_soulmate_id: soulmateId,
      p_keep: MEMORY_STORE_LIMIT,
    });
    if (pruneError) {
      this.logger.warn(`기억 정리 실패 [${pruneError.code}] ${pruneError.message}`);
    }
  }

  private toStreamError(err: unknown): ChatStreamEvent {
    if (err instanceof ModelRateLimitedError) {
      return {
        type: 'error',
        code: 'model_rate_limited',
        message: '지금 대화가 몰려 있어요. 잠시 후 다시 보내주세요.',
        retryAfterSeconds: err.retryAfterSeconds,
      };
    }
    if (err instanceof ModelBlockedError) {
      return {
        type: 'error',
        code: 'content_blocked',
        message: '그 얘기는 이어가기 어려워요. 다른 얘기 해볼까요?',
      };
    }
    if (err instanceof ApiException) {
      return { type: 'error', code: err.code, message: err.message };
    }
    this.logger.error(`대화 실패: ${err instanceof Error ? err.message : String(err)}`);
    return {
      type: 'error',
      code: 'model_unavailable',
      message: '답을 만들지 못했어요. 크레딧은 돌려드렸어요.',
    };
  }
}

function toDto(row: MessageRow): ChatMessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    emotion: row.emotion,
  };
}
