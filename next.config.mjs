/**
 * Next.js 配置
 *
 * 说明（见 docs/工程环境说明.md）：
 * 本机沙箱对「批量删除」有单回合 50 个文件的硬阈值，而 `next build` 默认会在
 * 构建前清空产物目录（cleanDistDir: true），一次清理就会撞上该阈值导致构建失败。
 * 故关闭自动清理；产物目录可用 NEXT_DIST_DIR 覆盖，便于用干净目录做验证构建。
 *
 * ⚠️ 发布约定（0.4.12 起，改自 0.4.11 那次「发布后线上还是旧版」的坑）：
 * 托管平台会复用同一个沙箱，且**不会**在重新发布时重建 Next 产物；
 * 它的上传明确排除了 `.next`（标准构建目录），但会带上 `.next-live` 这种非标准名。
 * 之前产物写在 `.next`，平台 `npm start` 读到的永远是沙箱里那份旧构建，
 * 于是代码改了、页脚版本号却不动。
 * 现在 package.json 的 build/start 统一 `NEXT_DIST_DIR=.next-live`：
 * 构建产物会随源码一起上传，平台即使不重建也能直接跑新产物。
 * 本地用非默认目录做验证构建时，仍可临时传 NEXT_DIST_DIR 覆盖。
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  cleanDistDir: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    /**
     * 把全站 CSS 内联进 HTML（0.3.11）
     *
     * 原来首屏要串两次往返：先取 HTML，解析出 `<link rel=stylesheet>` 再取 CSS。
     * 托管平台的回源一次约 2s，两趟就是 4s —— 正是「首屏四秒」的观感来源。
     * 内联后 CSS 随 HTML 一起到达，首屏只花一趟往返；代价是 HTML 大几 KB
     * （gzip 后约 +4KB），换掉一整趟 RTT 很划算。
     */
    inlineCss: true,
  },
  images: {
    /**
     * 图片改走「构建期预生成 + 自定义 loader」（0.3.11）
     *
     * 默认 loader 会把每张图交给 `/_next/image` 在**请求时**转码。托管平台网关不缓存
     * 它的产物，于是每张图对每个新访客都要转一次：线上实测首张 9.6s、热态 1.9s。
     * 首页十几张图，这是首屏四秒里最重的一块。
     *
     * 现在 srcset 直接指向 public/images/opt/ 下构建前生成好的静态 WebP（scripts/build-images.mjs），
     * 一次转码都不用做，浏览器还能按 30 天缓存。组件代码不需要改。
     */
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    // 商品图先用本地 /public 下的实拍图；远程图域待素材托管方案确定后补（见 08 技术边界）
    remotePatterns: [],
    // 现代格式优先：AVIF 通常比同质量 JPEG 小 40–50%，WebP 作回落（B-2.10）
    formats: ["image/avif", "image/webp"],
    // 自定义 loader 下，这两组尺寸仍然决定 <Image> 生成的 srcset 名单，
    // 必须与 scripts/build-images.mjs 的 WIDTHS 保持一致（否则会指到不存在的文件）
    imageSizes: [64, 96, 128, 240, 320],
    deviceSizes: [360, 414, 640, 768, 1024, 1280, 1600],
    // 优化后的图片 URL 带内容指纹，可长缓存；默认 60s 会让回访反复回源
    minimumCacheTTL: 2592000,
  },
  async headers() {
    return [
      {
        /**
         * 预生成的图片变体带内容指纹（名称含宽度档，源图换名才会变），可以放心 immutable。
         * 默认 max-age=0 会让回访每张图都先发一次条件请求 —— 在这个平台上一次就是 2s。
         */
        source: "/images/opt/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
