import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import type { PushStatus } from '@mysoulmate/shared';
import { AppConfig } from '../config/app-config';
import { SupabaseService } from '../supabase/supabase.module';
import { ApiException } from '../common/api-exception';

/** 이 횟수를 넘게 연속 실패한 구독은 대상에서 빼둔다. */
const MAX_FAILURES = 3;

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 한 사람에게 보낸 결과. */
export interface PushSendResult {
  /** 하나 이상의 기기에 성공했는지. */
  delivered: boolean;
  /** 죽은 주소로 판정되어 지운 기기 수. */
  removed: number;
}

/**
 * 웹 푸시 전송.
 *
 * VAPID 키가 없으면 조용히 꺼진 상태로 둔다. 알림은 부가 기능이라
 * 키를 아직 안 만든 배포에서 서비스 전체가 안 뜨면 곤란하다.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly supabase: SupabaseService,
  ) {
    this.enabled = this.configureWebPush();
  }

  /**
   * VAPID 설정. 성공하면 true.
   *
   * setVapidDetails 는 키 형식이 틀리면 **예외를 던진다**. 생성자에서 그냥 부르면
   * 값이 잘못 들어간 순간 NestJS 가 이 프로바이더를 만들지 못해 API 전체가 부팅에
   * 실패한다 — 알림만 죽는 게 아니라 대화까지 전부 멈춘다.
   *
   * 붙여넣다 잘리거나 앞뒤에 공백이 붙거나 public/private 를 바꿔 넣는 건 실제로 일어난다.
   * 환경변수 스키마로는 못 걸러낸다(길이만 볼 수 있다). 그래서 여기서 받아낸다.
   * 알림은 부가 기능이고, 그것 때문에 서비스가 안 뜨는 쪽이 훨씬 나쁘다.
   */
  private configureWebPush(): boolean {
    const vapid = this.config.vapid;
    if (!vapid) {
      this.logger.warn('VAPID 키가 없어 푸시 알림이 꺼져 있습니다.');
      return false;
    }

    try {
      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      this.logger.log('푸시 알림이 켜져 있습니다.');
      return true;
    } catch (err) {
      this.logger.error(
        `VAPID 키가 올바르지 않아 푸시 알림을 껐습니다. 나머지 기능은 정상 동작합니다. ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
      return false;
    }
  }

  async status(userId: string): Promise<PushStatus> {
    if (!this.enabled) return { available: false, publicKey: '', deviceCount: 0 };

    const { count, error } = await this.supabase.client
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`구독 조회 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }

    return {
      available: true,
      publicKey: this.config.vapid!.publicKey,
      deviceCount: count ?? 0,
    };
  }

  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<void> {
    if (!this.enabled) {
      throw ApiException.validationFailed('지금은 알림을 받을 수 없어요.');
    }

    const { error } = await this.supabase.client.rpc('upsert_push_subscription', {
      p_user: userId,
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
    });

    if (error) {
      this.logger.error(`구독 저장 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
    this.logger.log(`푸시 구독 등록 (user=${userId})`);
  }

  /**
   * 구독 해제.
   *
   * 소유자까지 조건에 넣는다. endpoint 만으로 지우게 두면 남의 주소를 알아낸 사람이
   * 그 사람의 알림을 끊을 수 있다.
   */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`구독 해제 실패 [${error.code}] ${error.message}`);
      throw ApiException.internal();
    }
  }

  /** 이 사용자의 모든 기기. */
  async targetsFor(userId: string): Promise<PushTarget[]> {
    const { data, error } = await this.supabase.client
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId)
      .lte('failure_count', MAX_FAILURES);

    if (error) {
      this.logger.error(`구독 목록 조회 실패 [${error.code}] ${error.message}`);
      return [];
    }
    return (data ?? []) as PushTarget[];
  }

  get maxFailures(): number {
    return MAX_FAILURES;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 한 사람의 모든 기기에 보낸다.
   *
   * 기기 하나가 실패해도 나머지는 보낸다 — 옛 기기의 죽은 주소 때문에
   * 지금 쓰는 기기가 알림을 못 받으면 안 된다.
   */
  async sendTo(
    userId: string,
    payload: { title: string; body: string; url: string },
  ): Promise<PushSendResult> {
    const targets = await this.targetsFor(userId);
    if (targets.length === 0) return { delivered: false, removed: 0 };

    const body = JSON.stringify(payload);
    let delivered = false;
    let removed = 0;

    for (const target of targets) {
      const outcome = await this.sendOne(target, body);
      if (outcome === 'sent') delivered = true;
      if (outcome === 'gone') removed++;
    }

    return { delivered, removed };
  }

  private async sendOne(target: PushTarget, body: string): Promise<'sent' | 'gone' | 'failed'> {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        body,
        // 잠금화면에 뜨는 알림이라 오래 들고 있을 이유가 없다.
        // 하루 뒤에 도착하는 "오늘 어땠어?" 는 없는 편이 낫다.
        { TTL: 6 * 60 * 60 },
      );
      await this.record(target.endpoint, { gone: false, success: true });
      return 'sent';
    } catch (err) {
      // 404/410 은 구독이 사라졌다는 뜻이다(앱 삭제, 권한 철회, 브라우저 정리).
      // 이건 오류가 아니라 상태 변화라서 바로 지우고 넘어간다.
      const status = (err as { statusCode?: number }).statusCode;
      const gone = status === 404 || status === 410;

      if (!gone) {
        this.logger.warn(
          `푸시 발송 실패 (${status ?? '알 수 없음'}) ${target.endpoint.slice(0, 60)}…`,
        );
      }
      await this.record(target.endpoint, { gone, success: false });
      return gone ? 'gone' : 'failed';
    }
  }

  private async record(
    endpoint: string,
    result: { gone: boolean; success: boolean },
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('record_push_result', {
      p_endpoint: endpoint,
      p_gone: result.gone,
      p_success: result.success,
    });
    // 기록 실패로 발송을 되돌릴 수는 없다. 다음 발송에서 다시 판정된다.
    if (error) this.logger.warn(`발송 결과 기록 실패 [${error.code}] ${error.message}`);
  }
}
