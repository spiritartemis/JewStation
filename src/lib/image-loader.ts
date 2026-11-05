import manifest from "@/lib/image-widths.json";

/**
 * next/image 自定义 loader（0.3.11）
 *
 * 不走 `/_next/image` 的请求时转码，直接指向构建期预生成的静态 WebP
 * （scripts/build-images.mjs 产出，见 next.config.mjs 的 loaderFile）。
 *
 * 为什么：托管平台的网关不缓存 `/_next/image` 的产物，每张图对每个新访客
 * 都要现场转码 —— 线上实测首张 9.6s、热态 1.9s。换成静态文件后一次都不用转码，
 * 还能吃到浏览器 30 天缓存。
 *
 * 档位夹取：srcset 按 deviceSizes 生成，可能超出原图宽度（1200 宽的图配 1600 档）。
 * 这里取「不超过 min(目标宽, 原图宽) 的最大已生成档位」，既不放大也不会指到不存在的文件。
 */
type LoaderArgs = { src: string; width: number; quality?: number };

const { sizes, natural } = manifest as { sizes: number[]; natural: Record<string, number> };

export default function imageLoader({ src, width }: LoaderArgs): string {
  // 只处理本站商品/场景图；图标、外部链接原样返回
  if (!src.startsWith("/images/")) return src;

  const base = src.replace(/^\/images\//, "").replace(/\.(jpe?g|png)$/i, "");
  const naturalWidth = natural[base];

  // 原图不在预处理清单里（新加图但没跑构建脚本）：退回原图，宁可大也不要 404
  if (!naturalWidth) return src;

  const cap = Math.min(width, naturalWidth);
  let target = sizes[0];
  for (const w of sizes) {
    if (w <= cap && w > target) target = w;
  }
  // cap 比最小档还小时也取最小档（只有极小缩略图会走到）
  if (cap < sizes[0]) target = sizes[0];

  return `/images/opt/${base}-${target}.webp`;
}
