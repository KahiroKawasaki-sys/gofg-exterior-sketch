// 外構スケッチ Pro のアイコン：いつものアイコンの下に「PRO」の帯をのせる（2本並んでも見分けられるように）
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
const dir = 'ios/App/App/Assets.xcassets/AppIconPro.appiconset';
await mkdir(dir, { recursive: true });
const band = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect x="0" y="744" width="1024" height="280" fill="#c8642a"/>
  <text x="512" y="935" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="190" letter-spacing="24" fill="#ffffff">PRO</text>
</svg>`);
await sharp('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png').resize(1024, 1024)
  .composite([{ input: band }]).flatten({ background: '#245a43' }).png().toFile(`${dir}/AppIconPro-512@2x.png`);
await writeFile(`${dir}/Contents.json`, JSON.stringify({ images: [{ idiom: 'universal', size: '1024x1024', filename: 'AppIconPro-512@2x.png', platform: 'ios' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
console.log('Pro icon generated.');
