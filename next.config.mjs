/**
 * Next.js 配置
 *
 * 说明（见 docs/工程环境说明.md）：
 * 本机沙箱对「批量删除」有单回合 50 个文件的硬阈值，而 `next build` 默认会在
 * 构建前清空产物目录（cleanDistDir: true），一次清理就会撞上该阈值导致构建失败。
 * 故关闭自动清理；产物目录可用 NEXT_DIST_DIR 覆盖，便于用干净目录做验证构建。
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  cleanDistDir: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    // 商品图先用本地 /public 下的实拍图；远程图域待素材托管方案确定后补（见 08 技术边界）
    remotePatterns: [],
    // 现代格式优先：AVIF 通常比同质量 JPEG 小 40–50%，WebP 作回落（B-2.10）
    formats: ["image/avif", "image/webp"],
    // 只声明实际会用到的宽度：商品卡 240 / 详情 600 / 缩略图 64，减少无谓的变体生成
    imageSizes: [64, 96, 128, 240, 320],
    deviceSizes: [360, 414, 640, 768, 1024, 1280, 1600],
    // 优化后的图片 URL 带内容指纹，可长缓存；默认 60s 会让回访反复回源
    minimumCacheTTL: 2592000,
  },
};

export default nextConfig;
