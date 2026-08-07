import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@mysoulmate/shared';
import { Public } from '../auth/public.decorator';
import { AppConfig } from '../config/app-config';

@Controller('health')
export class HealthController {
  constructor(private readonly config: AppConfig) {}

  /**
   * 의도적으로 DB를 건드리지 않는다.
   * "앱은 떠 있는데 DB 설정이 틀렸다"와 "앱이 안 떴다"를 구분할 수 있어야 한다.
   */
  @Public()
  @Get()
  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'mysoulmate-api',
      commit: this.config.commit,
      timestamp: new Date().toISOString(),
    };
  }
}
