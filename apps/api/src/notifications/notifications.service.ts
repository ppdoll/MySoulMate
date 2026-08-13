import { Injectable, Logger } from '@nestjs/common';
import {
  MEMORY_RECALL_LIMIT,
  PersonaSchema,
  type PushDispatchResult,
  type RelationshipTone,
} from '@mysoulmate/shared';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.module';
import { GeminiService } from '../ai/gemini.service';
import { PushService } from './push.service';
import {
  NOTIFICATION_SYSTEM_PROMPT,
  NotificationTextSchema,
  buildNotificationPrompt,
  fallbackNotification,
} from './notification-prompt';

interface TargetRow {
  user_id: string;
  soulmate_id: string;
  soulmate_name: string;
  tone: RelationshipTone;
  persona: unknown;
  display_name: string | null;
  last_message_at: string | null;
}

/**
 * 알림 발송.
 *
 * 하루 한 번, "한동안 오지 않은 사람" 에게만 보낸다.
 * Vercel Hobby 는 cron 이 하루 1회라 그 이상은 애초에 불가능하지만,
 * 컴패니언 앱에서 하루 한 번보다 잦은 알림은 그 자체로 스팸이기도 하다.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly supabase: SupabaseService,
    private readonly gemini: GeminiService,
    private readonly push: PushService,
  ) {}

  /**
   * 오늘 보낼 사람을 고르고 보낸다.
   *
   * 대상 선정과 "오늘 보냄" 기록이 한 SQL 문에서 함께 일어난다(claim_push_targets).
   * cron 은 재시도될 수 있어서, 나눠 두면 같은 사람에게 두 번 간다.
   */
  async dispatch(): Promise<PushDispatchResult> {
    if (!this.push.isEnabled) {
      this.logger.warn('VAPID 키가 없어 발송을 건너뜁니다.');
      return { targeted: 0, sent: 0, removed: 0, limited: false };
    }

    const limit = this.config.pushBatchLimit;
    const { data, error } = await this.supabase.client.rpc('claim_push_targets', {
      p_limit: limit,
      p_idle_hours: this.config.pushIdleHours,
      p_max_failures: this.push.maxFailures,
    });

    if (error) {
      this.logger.error(`발송 대상 조회 실패 [${error.code}] ${error.message}`);
      return { targeted: 0, sent: 0, removed: 0, limited: false };
    }

    const targets = (data ?? []) as TargetRow[];
    let sent = 0;
    let removed = 0;

    for (const target of targets) {
      const result = await this.sendOne(target);
      if (result.delivered) sent++;
      removed += result.removed;
    }

    // 상한에 정확히 걸렸다면 밀린 사람이 있을 수 있다.
    // 조용히 자르면 "전원에게 보냈다" 로 읽히므로 로그에 남긴다.
    const limited = targets.length === limit;
    this.logger.log(
      `알림 발송: 대상 ${targets.length}명, 도달 ${sent}명, 죽은 구독 ${removed}건 정리` +
        (limited ? ` (상한 ${limit}에 걸려 남은 대상은 다음 발송으로 밀립니다)` : ''),
    );

    return { targeted: targets.length, sent, removed, limited };
  }

  private async sendOne(target: TargetRow): Promise<{ delivered: boolean; removed: number }> {
    const persona = PersonaSchema.safeParse(target.persona);
    if (!persona.success) {
      this.logger.warn(`페르소나를 읽지 못해 건너뜁니다. soulmate=${target.soulmate_id}`);
      return { delivered: false, removed: 0 };
    }

    const body = await this.composeBody(target, persona.data);

    return this.push.sendTo(target.user_id, {
      // 제목은 캐릭터 이름. 잠금화면에서 누가 보냈는지가 먼저 보여야 한다.
      title: target.soulmate_name,
      body,
      url: '/chat',
    });
  }

  /**
   * 문구를 만든다.
   *
   * 모델을 쓰는 이유: 기억을 꺼내 물어보는 알림("그 발표 어떻게 됐어?")과
   * 고정 문구("소울메이트가 기다려요")는 열어보는 비율이 다르다.
   *
   * 실패하면 기본 문구로 보낸다. 문구를 못 만들었다고 알림을 거르면
   * 그날 그 사람은 아무 소식도 못 받는다.
   */
  private async composeBody(
    target: TargetRow,
    persona: ReturnType<typeof PersonaSchema.parse>,
  ): Promise<string> {
    try {
      const memories = await this.recallMemories(target.soulmate_id);
      const result = await this.gemini.generateJson({
        system: NOTIFICATION_SYSTEM_PROMPT,
        prompt: buildNotificationPrompt({
          persona,
          tone: target.tone,
          userName: target.display_name,
          gap: describeGap(target.last_message_at),
          timeOfDay: partOfDay(new Date()),
          memories,
        }),
        schema: NotificationTextSchema,
        retries: 0,
      });
      return result.body;
    } catch (err) {
      this.logger.warn(
        `알림 문구 생성 실패, 기본 문구로 보냅니다: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallbackNotification(persona);
    }
  }

  /** 프롬프트에 넣을 기억. 대화와 같은 순서(고정 -> 중요 -> 최근)로 가져온다. */
  private async recallMemories(soulmateId: string): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('memories')
      .select('content')
      .eq('soulmate_id', soulmateId)
      .order('pinned', { ascending: false })
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      // 알림 한 줄을 쓰는 데 24개는 필요 없다. 위쪽 몇 개면 충분하고 입력도 줄어든다.
      .limit(Math.min(6, MEMORY_RECALL_LIMIT));

    if (error) {
      this.logger.warn(`기억 조회 실패 [${error.code}] ${error.message}`);
      return [];
    }
    return (data ?? []).map((r: { content: string }) => r.content);
  }
}

/** 마지막 대화로부터의 공백. 대화 프롬프트의 것보다 거칠게 잡는다. */
function describeGap(lastMessageAt: string | null): string {
  if (!lastMessageAt) return '아직 대화를 나눈 적이 없습니다.';

  const last = new Date(lastMessageAt);
  if (Number.isNaN(last.getTime())) return '마지막 대화가 언제인지 알 수 없습니다.';

  const hours = (Date.now() - last.getTime()) / 3_600_000;
  if (hours < 48) return '어제 이후로 오지 않았습니다.';

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 동안 오지 않았습니다.`;
  if (days < 30) return `${Math.floor(days / 7)}주 동안 오지 않았습니다.`;
  return '한 달 넘게 오지 않았습니다.';
}

function partOfDay(date: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      hour: 'numeric',
      hour12: false,
    }).format(date),
  );
  if (hour < 5) return '새벽';
  if (hour < 11) return '아침';
  if (hour < 17) return '낮';
  if (hour < 21) return '저녁';
  return '밤';
}
