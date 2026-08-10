import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  SendMessageSchema,
  type ChatHistoryResponse,
  type ChatStreamEvent,
  type SendMessageRequest,
} from '@mysoulmate/shared';
import { ChatService } from './chat.service';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** 이전 대화. 오래된 것부터 정렬해서 준다. */
  @Get('messages')
  history(
    @CurrentUser() user: AuthUser,
    @Query('before') before?: string,
  ): Promise<ChatHistoryResponse> {
    return this.chat.history(user.id, before);
  }

  /**
   * 한 턴을 보내고 응답을 SSE로 받는다.
   *
   * WebSocket은 Vercel 서버리스에서 못 쓴다. EventSource는 헤더를 못 붙여
   * Bearer 토큰을 보낼 수 없으므로, 프론트는 fetch + ReadableStream으로 읽는다.
   */
  @Post()
  async send(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SendMessageSchema)) body: SendMessageRequest,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // 프록시가 버퍼링하면 스트리밍이 의미가 없어진다.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const write = (event: ChatStreamEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of this.chat.stream(user, body.text)) {
        write(event);
      }
    } catch (err) {
      // 여기까지 오면 서비스가 정규화하지 못한 오류다.
      // 이미 200과 헤더를 보낸 뒤라 상태 코드를 바꿀 수 없으니 이벤트로 알린다.
      write({
        type: 'error',
        code: 'internal_error',
        message: '연결이 끊겼어요. 다시 시도해 주세요.',
      });
      void err;
    } finally {
      res.end();
    }
  }
}
