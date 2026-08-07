import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/**
 * Vercel은 이 파일(`src/main.ts`)을 엔트리포인트로 자동 인식해서
 * NestJS 앱 전체를 Fluid compute 함수 하나로 올린다.
 * serverless-express 래퍼를 따로 둘 필요가 없다.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // 결제 웹훅 서명 검증에는 파싱 전 원문이 필요하다.
    // 나중에 붙이려면 부트스트랩을 고쳐야 하므로 처음부터 켜둔다.
    rawBody: true,
  });

  const config = app.get(AppConfig);

  app.enableCors({
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    // Bearer 토큰을 쓰므로 쿠키를 주고받을 이유가 없다.
    credentials: false,
    maxAge: 86400,
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen(config.env.PORT);
  Logger.log(`API listening on :${config.env.PORT} (${config.env.NODE_ENV})`, 'Bootstrap');
}

void bootstrap().catch((err: unknown) => {
  // 환경변수 누락 같은 설정 오류는 여기서 잡힌다.
  // 조용히 죽으면 Vercel 로그에 아무것도 안 남아 원인을 못 찾는다.
  Logger.error(err instanceof Error ? err.message : String(err), undefined, 'Bootstrap');
  process.exit(1);
});
