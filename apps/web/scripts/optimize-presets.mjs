// 프리셋 캐릭터 PNG를 WebP로 변환한다.
//
//   pnpm --filter @mysoulmate/web presets:optimize
//
// 나노바나나가 내주는 PNG는 장당 1MB를 넘는다. 16장이면 그대로 20MB가
// 정적 자원으로 올라가고 첫 로딩이 느려진다. WebP로 줄이면 장당 100KB 안쪽이 된다.
//
// 원본 PNG는 지우지 않는다. 나중에 표정을 추가하거나 다시 뽑을 때 필요하다.
// (.gitignore 에서 PNG는 제외하고 WebP만 커밋한다)
import { readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const presetsDir = path.join(here, '..', 'public', 'presets');

const SIZE = 768;
const QUALITY = 82;

if (!existsSync(presetsDir)) {
  await mkdir(presetsDir, { recursive: true });
  console.log(`${presetsDir} 를 만들었습니다. 여기에 캐릭터 폴더를 넣어주세요.`);
  console.log('예: public/presets/bright/neutral.png');
  process.exit(0);
}

const characters = (await readdir(presetsDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (characters.length === 0) {
  console.log('변환할 캐릭터 폴더가 없습니다.');
  console.log('public/presets/<캐릭터>/<표정>.png 형태로 넣어주세요.');
  process.exit(0);
}

let converted = 0;
let skipped = 0;

for (const character of characters) {
  const dir = path.join(presetsDir, character);
  const pngs = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.png'));

  for (const png of pngs) {
    const src = path.join(dir, png);
    const out = src.replace(/\.png$/i, '.webp');

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
      `  ${character}/${png} -> ${path.basename(out)}  ${(info.size / 1024).toFixed(0)}KB`,
    );
    converted++;
  }
}

console.log('');
console.log(`변환 ${converted}건, 최신이라 건너뜀 ${skipped}건`);
if (converted === 0 && skipped === 0) {
  console.log('PNG 파일을 찾지 못했습니다.');
}
