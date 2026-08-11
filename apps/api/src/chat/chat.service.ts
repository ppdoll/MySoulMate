import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  CREDIT_COSTS,
  FREE_DAILY_CHAT_TURNS,
  PersonaSchema,
  parseEmotionTag,
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
import { SUMMARY_SYSTEM_PROMPT, buildChatSystemPrompt, buildTimeContext } from './prompt';

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
      freeAllowance: FREE_DAILY_CHAT_TURNS,
      refType: 'conversation',
      refId: ctx.conversationId,
      unlimited: user.isAdmin,
    });

    let answer = '';
    try {
      // 임계치를 넘었으면 여기서 한 번 압축한다.
      // 20턴에 한 번 이 턴만 조금 느려지고, 이후 입력 토큰이 다시 줄어든다.
      const summary = await this.maybeSummarize(ctx);

      const history = await this.recentMessages(ctx.conversationId, CONTEXT_MESSAGES);
      const system = buildChatSystemPrompt({
        persona: ctx.persona,
        tone: ctx.tone,
        summary,
        userName: ctx.userName,
        timeContext: buildTimeContext(new Date(), ctx.lastMessageAt),
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

      // 감정 태그는 표정 교체용이라 기록에는 남기지 않는다.
      // 남겨두면 다음 턴 컨텍스트에 섞여 들어가고 화면에도 보인다.
      const { rest } = parseEmotionTag(answer);
      const messageId = await this.persistTurn(ctx.conversationId, text, rest.trim() || answer);
      const wallet = await this.credits.getWallet(user.id);
      yield { type: 'done', messageId, wallet };
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
      .select('id, role, content, created_at')
      .eq('conversation_id', ctx.conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(CONTEXT_MESSAGES + 1);

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error) {
      this.logger.error(`대화 기록 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    const rows = (data ?? []) as MessageRow[];
    const hasMore = rows.length > CONTEXT_MESSAGES;
    const page = hasMore ? rows.slice(0, CONTEXT_MESSAGES) : rows;

    return {
      // 조회는 최신순이지만 화면은 오래된 것부터 그린다.
      messages: page.reverse().map(toDto),
      hasMore,
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
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`최근 메시지 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    return ((data ?? []) as MessageRow[]).reverse();
  }

  /** 사용자 메시지와 응답을 한 번에 넣는다. 하나의 INSERT 라 둘 중 하나만 남는 일이 없다. */
  private async persistTurn(
    conversationId: string,
    userText: string,
    answer: string,
  ): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('messages')
      .insert([
        { conversation_id: conversationId, role: 'user', content: userText },
        { conversation_id: conversationId, role: 'assistant', content: answer },
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
   * 요약이 필요하면 만들고, 아니면 기존 요약을 그대로 돌려준다.
   *
   * 오래된 메시지를 지우지는 않는다 — 기록은 사용자의 것이고,
   * 컨텍스트에 넣지 않을 뿐이다.
   */
  private async maybeSummarize(ctx: ConversationContext): Promise<string> {
    const { count, error } = await this.supabase.client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', ctx.conversationId);

    if (error || (count ?? 0) <= SUMMARY_THRESHOLD) return ctx.summary;

    const { data, error: fetchError } = await this.supabase.client
      .from('messages')
      .select('role, content')
      .eq('conversation_id', ctx.conversationId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(SUMMARY_BATCH);

    if (fetchError || !data?.length) return ctx.summary;

    const transcript = (data as { role: string; content: string }[])
      .map((m) => `${m.role === 'user' ? '사용자' : ctx.persona.name}: ${m.content}`)
      .join('\n');

    try {
      const result = await this.gemini.generateJson({
        system: SUMMARY_SYSTEM_PROMPT,
        prompt: ctx.summary
          ? `# 기존 요약\n${ctx.summary}\n\n# 새로 합칠 대화\n${transcript}`
          : `# 대화\n${transcript}`,
        schema: z.object({ summary: z.string().min(1).max(600) }),
        retries: 0,
      });

      await this.supabase.client
        .from('conversations')
        .update({ summary: result.summary })
        .eq('id', ctx.conversationId);

      return result.summary;
    } catch (err) {
      // 요약 실패로 대화 자체를 막을 이유는 없다. 기존 요약으로 계속 간다.
      this.logger.warn(
        `요약 실패, 기존 요약 유지: ${err instanceof Error ? err.message : String(err)}`,
      );
      return ctx.summary;
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
  };
}
