import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { AppConfig } from '../config/app-config';
import { ModelBlockedError, ModelUnavailableError, normalizeProviderError } from './errors';

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
}

export interface ImageInput {
  data: Buffer;
  mimeType: string;
}

/**
 * Gemini 호출을 감싸는 유일한 지점.
 *
 * 호출부(페르소나·아바타 서비스)는 이 인터페이스만 보고,
 * SDK 응답 구조나 오류 형태를 알지 못한다.
 * 나중에 유료 티어를 다른 제공자로 돌리더라도 여기만 갈아끼우면 된다.
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly ai: GoogleGenAI;

  constructor(private readonly config: AppConfig) {
    this.ai = new GoogleGenAI({ apiKey: config.env.GEMINI_API_KEY });
  }

  /**
   * 지정한 zod 스키마 형태로 JSON을 생성시킨다.
   *
   * 스키마를 JSON Schema로 변환해 모델에 강제하고, 돌아온 값을 같은 스키마로 다시 검증한다.
   * 형식 단일 출처가 zod 하나라 프롬프트와 파싱이 어긋날 일이 없다.
   */
  async generateJson<T>(params: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    /** 형식이 어긋났을 때 다시 시도할 횟수. 모델이 가끔 필드를 빠뜨린다. */
    retries?: number;
  }): Promise<T> {
    const retries = params.retries ?? 1;
    const jsonSchema = z.toJSONSchema(params.schema);
    let lastIssue = '';

    for (let attempt = 0; attempt <= retries; attempt++) {
      const raw = await this.callText({
        system: params.system,
        prompt:
          attempt === 0
            ? params.prompt
            : `${params.prompt}\n\n이전 응답이 형식에 맞지 않았습니다: ${lastIssue}\n스키마를 정확히 지켜 다시 작성하세요.`,
        jsonSchema,
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        lastIssue = 'JSON으로 파싱되지 않음';
        continue;
      }

      const result = params.schema.safeParse(parsed);
      if (result.success) return result.data;

      lastIssue = result.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(', ');
      this.logger.warn(`구조화 출력 검증 실패 (시도 ${attempt + 1}/${retries + 1}): ${lastIssue}`);
    }

    throw new ModelUnavailableError(`응답이 형식에 맞지 않습니다 — ${lastIssue}`);
  }

  private async callText(params: {
    system: string;
    prompt: string;
    jsonSchema: unknown;
  }): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: this.config.env.GEMINI_TEXT_MODEL,
        contents: params.prompt,
        config: {
          systemInstruction: params.system,
          responseMimeType: 'application/json',
          responseJsonSchema: params.jsonSchema,
        },
      });

      const text = response.text;
      if (!text) {
        // 안전 필터에 걸리면 후보 없이 finishReason만 돌아온다.
        const reason = response.candidates?.[0]?.finishReason;
        if (reason && reason !== 'STOP') {
          throw new ModelBlockedError(`생성이 중단되었습니다 (${reason})`);
        }
        throw new ModelUnavailableError('빈 응답');
      }
      return text;
    } catch (err) {
      if (err instanceof ModelBlockedError || err instanceof ModelUnavailableError) throw err;
      throw normalizeProviderError(err);
    }
  }

  /**
   * 이미지를 생성한다.
   *
   * baseImage를 함께 넘기면 그 이미지를 편집하는 방식으로 동작한다.
   * 아바타 재생성에서 같은 인물을 유지하려면 반드시 이전 이미지를 넣어야 한다 —
   * 프롬프트만 다시 던지면 매번 다른 얼굴이 나온다.
   */
  async generateImage(params: { prompt: string; baseImage?: ImageInput }): Promise<GeneratedImage> {
    const contents = params.baseImage
      ? [
          { text: params.prompt },
          {
            inlineData: {
              mimeType: params.baseImage.mimeType,
              data: params.baseImage.data.toString('base64'),
            },
          },
        ]
      : params.prompt;

    try {
      const response = await this.ai.models.generateContent({
        model: this.config.env.GEMINI_IMAGE_MODEL,
        contents,
      });

      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        const inline = part.inlineData;
        if (inline?.data) {
          return {
            data: Buffer.from(inline.data, 'base64'),
            mimeType: inline.mimeType ?? 'image/png',
          };
        }
      }

      // 이미지 대신 텍스트만 오는 경우는 대개 모델이 거절한 것이고, 그 이유가 텍스트에 담겨 있다.
      const explanation = response.text?.slice(0, 200);
      const reason = response.candidates?.[0]?.finishReason;
      this.logger.warn(`이미지 파트 없음 (finishReason=${reason ?? 'none'}): ${explanation ?? ''}`);
      throw new ModelBlockedError(explanation || '이미지를 만들지 못했어요.');
    } catch (err) {
      if (err instanceof ModelBlockedError) throw err;
      throw normalizeProviderError(err);
    }
  }
}
