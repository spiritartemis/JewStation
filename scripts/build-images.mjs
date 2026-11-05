/**
 * 构建期图片预处理（0.3.11）
 *
 * 为什么要做：Next 的 `/_next/image` 是**请求时**转码。本项目的托管平台网关不缓存
 * 优化后的图，于是每张图对每个新访客都要现场转一次 —— 线上实测首张图 9.6s、
 * 热态也要 1.9s。首页有十几张图，这是首屏四秒里最重的一块。
 *
 * 做法：构建前把每张原图按 srcset 会用到的宽度预生成成 WebP，放进 public/images/opt/。
 * 运行时 `src/lib/image-loader.ts` 直接把 URL 指向这些静态文件，完全不走转码。
 *
 * 宽度档必须与 next.config.mjs 的 deviceSizes ∪ imageSizes 对齐；
 * 另外生成 src/lib/image-widths.json 记录每张原图的真实宽度，
 * loader 据此把过大的档位夹到原图宽度，避免放大与 404。
 *
 * 幂等：输出比源文件新就跳过，重复构建不重复编码。
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC_DIR = "public/images";
const OUT_DIR = "public/images/opt";
const WIDTHS = [64, 96, 128, 240, 320, 360, 414, 640, 768, 1024, 1280, 1600];
const QUALITY = 76;

await fs.mkdir(OUT_DIR, { recursive: true });

const files = (await fs.readdir(SRC_DIR)).filter((f) => /\.(jpe?g|png)$/i.test(f));
const widthsByBase = {};
let encoded = 0;
let skipped = 0;
let bytesOut = 0;

for (const file of files) {
  const base = file.replace(/\.(jpe?g|png)$/i, "");
  const srcPath = path.join(SRC_DIR, file);
  const srcStat = await fs.stat(srcPath);
  const meta = await sharp(srcPath).metadata();
  const naturalWidth = meta.width ?? 1600;
  widthsByBase[base] = naturalWidth;

  for (const w of WIDTHS) {
    // 不放大的档位不生成，loader 会把它们夹到原图宽度
    if (w > naturalWidth) continue;

    const outPath = path.join(OUT_DIR, `${base}-${w}.webp`);
    try {
      const outStat = await fs.stat(outPath);
      if (outStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        bytesOut += outStat.size;
        continue;
      }
    } catch {
      /* 不存在，继续生成 */
    }

    await sharp(srcPath)
      .resize({ width: w })
      .webp({ quality: QUALITY, effort: 4 })
      .toFile(outPath);
    const st = await fs.stat(outPath);
    encoded++;
    bytesOut += st.size;
  }
}

await fs.writeFile(
  "src/lib/image-widths.json",
  JSON.stringify({ sizes: WIDTHS, natural: widthsByBase }, null, 2) + "\n",
  "utf8",
);

console.log(
  `[images] ${files.length} 张原图 → 编码 ${encoded} 个变体，跳过 ${skipped} 个（已最新），` +
    `产物合计 ${(bytesOut / 1024 / 1024).toFixed(2)}MB`,
);
