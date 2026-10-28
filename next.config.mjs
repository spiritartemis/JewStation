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
  },
};

export default nextConfig;
