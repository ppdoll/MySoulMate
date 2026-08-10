// GEMINI_API_KEY가 실제로 동작하는지 미리 확인한다.
//
//   pnpm --filter @mysoulmate/api check:gemini
//
// 텍스트와 이미지는 과금 조건이 다르다. 텍스트는 무료 티어가 있지만
// 이미지는 결제가 켜져 있어야 한다. 온보딩 도중에 이걸 처음 알게 되면
// "만들다가 실패했다"는 증상만 보여 원인을 찾기 어렵다.
//
// 키 값은 출력하지 않는다.
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const key = process.env.GEMINI_API_KEY;
const textModel = process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash';
const imageModel = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';

if (!key) {
  console.error('GEMINI_API_KEY 가 없습니다. apps/api/.env 에 넣어주세요.');
  process.exit(1);
}

console.log(`키 형식   : ${key.startsWith('AQ.') ? 'AQ. (현행)' : key.startsWith('AIza') ? 'AIza (구형 — 2026년 9월 이후 거부됨)' : '알 수 없음'}`);
console.log(`텍스트 모델: ${textModel}`);
console.log(`이미지 모델: ${imageModel}`);
console.log('');

const ai = new GoogleGenAI({ apiKey: key });
let failed = false;

// --- 텍스트 (페르소나 생성 경로) -------------------------------------------
try {
  const res = await ai.models.generateContent({
    model: textModel,
    contents: '한국어로 "안녕"이라고만 대답하세요.',
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { greeting: { type: 'string' } },
        required: ['greeting'],
      },
    },
  });
  const parsed = JSON.parse(res.text ?? '{}');
  console.log(`✅ 텍스트 OK — 응답: ${JSON.stringify(parsed)}`);
} catch (err) {
  failed = true;
  console.log(`❌ 텍스트 실패 — ${diagnose(err)}`);
}

// --- 이미지 (아바타 생성 경로) ---------------------------------------------
try {
  const res = await ai.models.generateContent({
    model: imageModel,
    contents: 'A simple flat illustration of a single green leaf on a white background.',
  });

  const part = (res.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part) {
    failed = true;
    console.log(`❌ 이미지 실패 — 이미지가 오지 않았습니다: ${res.text?.slice(0, 160) ?? '(설명 없음)'}`);
  } else {
    const bytes = Buffer.from(part.inlineData.data, 'base64').length;
    console.log(`✅ 이미지 OK — ${(bytes / 1024).toFixed(0)}KB, ${part.inlineData.mimeType}`);
  }
} catch (err) {
  failed = true;
  console.log(`❌ 이미지 실패 — ${diagnose(err)}`);
}

console.log('');
if (failed) {
  console.log('두 항목이 모두 OK 여야 온보딩이 끝까지 동작합니다.');
  process.exit(1);
}
console.log('둘 다 통과했습니다. 온보딩을 진행해도 됩니다.');

function diagnose(err) {
  const message = err instanceof Error ? err.message : String(err);
  const status = err?.status ?? err?.code;

  if (/API key not valid|API_KEY_INVALID|401|403/i.test(`${status} ${message}`)) {
    return '키가 유효하지 않거나 권한이 없습니다. AI Studio에서 다시 발급해 보세요.';
  }
  if (/billing|BILLING|FAILED_PRECONDITION/i.test(message)) {
    return '결제가 켜져 있지 않습니다. 이미지 모델은 무료 티어가 없어 Cloud Billing이 필요합니다.';
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(`${status} ${message}`)) {
    return '한도 초과입니다(무료 티어는 분당 10회). 잠시 뒤 다시 시도해 보세요.';
  }
  if (/not found|NOT_FOUND|404/i.test(`${status} ${message}`)) {
    return '모델 ID를 찾을 수 없습니다. GEMINI_TEXT_MODEL / GEMINI_IMAGE_MODEL 을 확인하세요.';
  }
  return message.slice(0, 300);
}
