// Gemini 키가 실제로 동작하는지 미리 확인한다.
//
//   pnpm --filter @mysoulmate/api check:gemini
//
// 텍스트와 이미지는 과금 조건이 다르다. 텍스트는 무료 티어가 있지만
// 이미지는 무료 티어가 없어 결제가 연결된 프로젝트여야 한다.
// 그래서 키를 나눠 쓸 수 있고, 이 스크립트는 각 용도의 키를 따로 검사한다.
//
// 온보딩 도중에 처음 알게 되면 "만들다가 실패했다" 는 증상만 남아 원인을 찾기 어렵다.
// 키 값은 출력하지 않는다.
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const shared = process.env.GEMINI_API_KEY;
const textKey = process.env.GEMINI_TEXT_API_KEY || shared;
const imageKey = process.env.GEMINI_IMAGE_API_KEY || shared;
const textModel = process.env.GEMINI_TEXT_MODEL ?? 'gemini-3.6-flash';
const imageModel = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';

if (!textKey || !imageKey) {
  console.error(
    '키가 없습니다. GEMINI_API_KEY 하나를 넣거나,\n' +
      'GEMINI_TEXT_API_KEY / GEMINI_IMAGE_API_KEY 를 각각 넣어주세요. (apps/api/.env)',
  );
  process.exit(1);
}

console.log(`키 구성    : ${textKey === imageKey ? '공용 키 1개' : '텍스트/이미지 분리됨'}`);
console.log(`텍스트 키  : ${describeKey(textKey)}`);
console.log(`이미지 키  : ${describeKey(imageKey)}`);
console.log(`텍스트 모델: ${textModel}`);
console.log(`이미지 모델: ${imageModel}`);
console.log('');

let failed = false;

// --- 텍스트 (페르소나·대화 경로) -------------------------------------------
// 사고 강도를 바꿔 두 번 호출해 토큰 차이를 같이 보여준다.
// 사고 토큰은 출력 단가로 과금되는데 실제로는 출력보다 훨씬 크기 때문에,
// 여기서 나오는 차이가 대화 비용을 정하는 가장 큰 변수다.
const textAi = new GoogleGenAI({ apiKey: textKey });

async function callText(thinkingLevel) {
  return textAi.models.generateContent({
    model: textModel,
    contents: '한국어로 "안녕"이라고만 대답하세요.',
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { greeting: { type: 'string' } },
        required: ['greeting'],
      },
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    },
  });
}

let baseThoughts = null;
try {
  const res = await callText(null);
  baseThoughts = res.usageMetadata?.thoughtsTokenCount ?? 0;
  console.log(`✅ 텍스트 OK — 응답: ${res.text?.trim()}  ${usage(res)}`);
} catch (err) {
  failed = true;
  console.log(`❌ 텍스트 실패 — ${diagnose(err)}`);
}

if (baseThoughts !== null) {
  try {
    const res = await callText('MINIMAL');
    const minimal = res.usageMetadata?.thoughtsTokenCount ?? 0;
    const saved = baseThoughts > 0 ? Math.round((1 - minimal / baseThoughts) * 100) : 0;
    console.log(
      `   thinking=MINIMAL 비교 — think ${baseThoughts} -> ${minimal}` +
        (saved > 0 ? ` (${saved}% 감소)` : ' (변화 없음 — 이 모델은 하한이 있을 수 있음)'),
    );
    console.log('   적용하려면 GEMINI_THINKING_LEVEL=MINIMAL');
  } catch {
    console.log('   thinking=MINIMAL 비교 — 이 모델은 사고 강도 조절을 지원하지 않습니다');
  }
}

// --- 이미지 (아바타 경로) ---------------------------------------------------
try {
  const ai = new GoogleGenAI({ apiKey: imageKey });
  const res = await ai.models.generateContent({
    model: imageModel,
    contents: 'A simple flat illustration of a single green leaf on a white background.',
  });

  const part = (res.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data);
  if (!part) {
    failed = true;
    console.log(
      `❌ 이미지 실패 — 이미지가 오지 않았습니다: ${res.text?.slice(0, 160) ?? '(설명 없음)'}`,
    );
  } else {
    const kb = (Buffer.from(part.inlineData.data, 'base64').length / 1024).toFixed(0);
    console.log(`✅ 이미지 OK — ${kb}KB ${part.inlineData.mimeType}  ${usage(res)}`);
  }
} catch (err) {
  failed = true;
  console.log(`❌ 이미지 실패 — ${diagnose(err)}`);
}

console.log('');
if (failed) {
  console.log('두 항목이 모두 OK 여야 온보딩이 끝까지 동작합니다.');
  console.log('텍스트만 실패한다면 텍스트 키를, 이미지만 실패한다면 이미지 키를 확인하세요.');
  process.exit(1);
}
console.log('둘 다 통과했습니다. 온보딩을 진행해도 됩니다.');

function describeKey(key) {
  if (key.startsWith('AQ.')) return 'AQ. (현행 형식)';
  if (key.startsWith('AIza')) return 'AIza (구형 — 2026년 9월 이후 거부됨)';
  return '알 수 없는 형식';
}

function usage(res) {
  const m = res.usageMetadata;
  if (!m) return '';
  const bits = [`in=${m.promptTokenCount ?? 0}`, `out=${m.candidatesTokenCount ?? 0}`];
  if (m.thoughtsTokenCount) bits.push(`think=${m.thoughtsTokenCount}`);
  return `[${bits.join(' ')}]`;
}

/**
 * 실패 원인을 사람이 읽을 수 있는 문장으로 바꾼다.
 *
 * 추측한 원인만 보여주고 원문을 감추면, 추측이 틀렸을 때 오히려 원인 파악이 늦어진다.
 * 항상 제공자가 준 원문을 함께 남긴다.
 */
function diagnose(err) {
  const message = err instanceof Error ? err.message : String(err);
  const status = err?.status ?? err?.code;
  const haystack = `${status} ${message}`;

  const hint = (() => {
    // 선불 잔액이 0이면 무료 티어로 내려가지 않고 모든 키가 함께 막힌다.
    if (/prepay|balance|credit|CREDITS_EXHAUSTED/i.test(haystack)) {
      return [
        '선불 크레딧 잔액이 0입니다. 이 상태에서는 무료 티어로도 호출되지 않고,',
        '해당 결제 계정에 연결된 모든 키가 함께 막힙니다.',
        'AI Studio 결제 페이지에서 충전하거나(최소 $10),',
        '텍스트는 결제를 연결하지 않은 별도 프로젝트 키로 분리하세요.',
      ].join(' ');
    }
    if (/API key not valid|API_KEY_INVALID|401|403/i.test(haystack)) {
      return '키가 유효하지 않거나 권한이 없습니다. AI Studio에서 다시 발급해 보세요.';
    }
    if (/billing|BILLING|FAILED_PRECONDITION/i.test(haystack)) {
      return '결제 설정 문제입니다. 결제 계정 연결과 크레딧 잔액을 모두 확인하세요.';
    }
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(haystack)) {
      return '한도 초과입니다(무료 티어는 분당 10회). 잠시 뒤 다시 시도해 보세요.';
    }
    if (/not found|NOT_FOUND|404/i.test(haystack)) {
      return '모델 ID를 찾을 수 없습니다. GEMINI_TEXT_MODEL / GEMINI_IMAGE_MODEL 을 확인하세요.';
    }
    return null;
  })();

  const raw = `원문: ${message.replace(/\s+/g, ' ').slice(0, 300)}`;
  return hint ? `${hint}\n   ${raw}` : raw;
}
