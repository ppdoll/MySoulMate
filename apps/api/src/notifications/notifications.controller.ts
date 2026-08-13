import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  PushSubscribeSchema,
  PushUnsubscribeSchema,
  type PushDispatchResult,
  type PushStatus,
  type PushSubscribeRequest,
  type PushTestResult,
  type PushUnsubscribeRequest,
} from '@mysoulmate/shared';
import { PushService } from './push.service';
import { NotificationsService } from './notifications.service';
import { AppConfig } from '../config/app-config';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApiException } from '../common/api-exception';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly push: PushService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  /** 알림을 받을 수 있는 상태인지, 이 계정에 등록된 기기가 몇 개인지. */
  @Get()
  status(@CurrentUser() user: AuthUser): Promise<PushStatus> {
    return this.push.status(user.id);
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PushSubscribeSchema)) body: PushSubscribeRequest,
  ): Promise<void> {
    return this.push.subscribe(user.id, body);
  }

  @Delete('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PushUnsubscribeSchema)) body: PushUnsubscribeRequest,
  ): Promise<void> {
    return this.push.unsubscribe(user.id, body.endpoint);
  }

  /**
   * 본인에게 한 통 보내본다.
   *
   * 실제 발송 경로를 그대로 태우되 "오늘 보냄" 은 기록하지 않는다 —
   * 확인하느라 그날의 실제 알림을 잃으면 안 된다.
   * 자기 계정의 기기에만 간다.
   */
  @Post('test')
  sendTest(@CurrentUser() user: AuthUser): Promise<PushTestResult> {
    return this.notifications.sendTest(user.id);
  }

  /**
   * 발송. Vercel Cron 이 하루 한 번 호출한다.
   *
   * 로그인 토큰이 없으므로(cron 은 사용자가 아니다) 가드를 열고 시크릿으로 막는다.
   * CRON_SECRET 이 설정돼 있지 않으면 아예 동작하지 않는다 — 시크릿 없이 배포했을 때
   * 아무나 알림을 쏠 수 있게 되는 쪽이 훨씬 나쁘다.
   *
   * GET 인 이유: Vercel Cron 은 GET 만 보낸다.
   */
  @Public()
  @Get('dispatch')
  dispatch(
    @Headers('authorization') authorization?: string,
    /**
     * `?dry=1` 이면 대상만 세고 아무것도 보내지 않는다.
     * "오늘 보냄" 도 기록되지 않으므로 몇 번이든 눌러볼 수 있고,
     * 확인한 뒤에 실제 발송을 그대로 할 수 있다.
     */
    @Query('dry') dry?: string,
  ): Promise<PushDispatchResult> {
    const secret = this.config.env.CRON_SECRET;
    if (!secret) {
      throw ApiException.forbidden('발송 엔드포인트가 설정되지 않았습니다.');
    }
    if (authorization !== `Bearer ${secret}`) {
      // 무엇이 틀렸는지 알려주지 않는다.
      throw ApiException.forbidden();
    }
    return this.notifications.dispatch({ dryRun: dry === '1' || dry === 'true' });
  }
}
