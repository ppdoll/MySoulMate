// 프리셋 캐릭터 원본 PNG를 WebP로 변환한다.
//
//   pnpm --filter @mysoulmate/web presets:optimize
//
// 원본:  img/SoulMate/{성별}_{분위기}_{표정}.png   (예: w_bright_normal.png)
// 결과:  apps/web/public/presets/{성별}_{분위기}/{표정}.webp
//
// 나노바나나가 내주는 PNG는 장당 3~11MB다. 28장이면 그대로 200MB가 정적 자원으로
// 올라간다. WebP로 줄이면 장당 100KB 안쪽이 된다.
// 원본 PNG는 `/img/` 에 그대로 두고 커밋하지 않는다(.gitignore). WebP만 커밋한다.
//
// 필요한 목록을 packages/shared 의 PRESET_CHARACTERS × EXPRESSIONS 에서 가져오는 이유:
// 예전에는 원본을 손으로 복사·개명해서 public/presets 에 넣었는데, 그러다 파일이
// 빠져도 아무도 몰랐다(m_chic_normal.png 가 그렇게 누락됐다).
// 이제 앱이 필요로 하는 것과 스크립트가 찾는 것이 같은 출처에서 나온다.
import { mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { EXPRESSIONS, PRESET_CHARACTERS } from '@mysoulmate/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(here, '..', '..', '..', 'img', 'SoulMate');
const outRoot = path.join(here, '..', 'public', 'presets');

const SIZE = 768;
const QUALITY = 82;

/** 원본 파일명은 neutral 을 normal 로 쓴다. */
const SOURCE_EXPRESSION = { neutral: 'normal' };

if (!existsSync(sourceDir)) {
  console.error(`원본 폴더가 없습니다: ${sourceDir}`);
  console.error('img/SoulMate/w_bright_normal.png 형태로 넣어주세요.');
  process.exit(1);
}

let converted = 0;
let skipped = 0;
const missing = [];

for (const character of PRESET_CHARACTERS) {
  const outDir = path.join(outRoot, character.id);
  await mkdir(outDir, { recursive: true });

  for (const expression of EXPRESSIONS) {
    const sourceName = `${character.id}_${SOURCE_EXPRESSION[expression] ?? expression}.png`;
    const src = path.join(sourceDir, sourceName);
    const out = path.join(outDir, `${expression}.webp`);

    if (!existsSync(src)) {
      missing.push(`${sourceName}  (필요: presets/${character.id}/${expression}.webp)`);
      continue;
    }

    // 원본이 더 새것일 때만 다시 만든다.
    if (existsSync(out)) {
      const [a, b] = await Promise.all([stat(src), stat(out)]);
      if (b.mtimeMs >= a.mtimeMs) {
        skipped++;
        continue;
      }
    }

    const info = await sharp(src)
      .resize(SIZE, SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: QUALITY })
      .toFile(out);

    console.log(
      `  ${sourceName} -> ${character.id}/${expression}.webp  ${(info.size / 1024).toFixed(0)}KB`,
    );
    converted++;
  }
}

console.log('');
console.log(`변환 ${converted}건, 최신이라 건너뜀 ${skipped}건`);

if (missing.length > 0) {
  // 실패로 끝내지 않는다. 표정 하나가 없어도 나머지는 쓸 수 있고,
  // neutral 이 없는 캐릭터만 화면에서 빈 칸이 된다.
  console.log('');
  console.log(`원본이 없어 건너뛴 ${missing.length}건:`);
  for (const line of missing) console.log(`  - ${line}`);
}
