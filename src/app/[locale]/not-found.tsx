import Link from "next/link";
import { localePath } from "@/i18n/config";

/**
 * 404
 *
 * 为什么是「两套文案 + CSS 择一」而不是读 headers 判语言（0.3.11 改）：
 *
 * 之前这里用 `headers().get("x-locale")` 取中间件注入的语言。代价是**整个 [locale] 段**
 * 被 Next 判定成动态渲染 —— 构建产物里 /en、/zh 全都没有预渲染 HTML，
 * 响应头退回 `Cache-Control: private, no-cache, no-store`，边缘无法缓存，
 * 首屏从 ~0.1s 掉到 4s（0.3.10 验收报告里那条「高」）。
 *
 * 现在两套语言的文案都由服务端输出，按 <html lang> 用 CSS 择一显示（见 globals.css 的 .i18n-*）：
 *  - 页面保持纯静态、状态码保持 404、首屏不额外请求；
 *  - 中文访客只看得到中文版，英文访客只看得到英文版，链接也各自带对前缀。
 *
 * 不要改回客户端组件：not-found 一旦是 client component，服务端就不渲染内容，
 * 爬虫看到的是一张空页，状态码还会掉成 200。
 */
export default function NotFound() {
  return (
    <>
      {/*
        404 走的是 Next 的 error shell，那个 <html> 不带 lang，
        CSS 的 :lang() 就判不出该给哪一版文案。这段同步内联脚本在内容之前执行，
        绘制前把 lang 补上（浏览器 URL 仍带 /zh 前缀，改写是服务端内部做的）。
        JS 被禁用时会退回英文版 —— 内容本身已经服务端直出，不影响可读性。
      */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            'document.documentElement.lang=location.pathname==="/zh"||location.pathname.indexOf("/zh/")===0?"zh-CN":"en";',
        }}
      />

      <div className="shell py-sp6">
        <h1 className="font-serif text-h1 text-ink">
          <span className="i18n-en">Page not found</span>
          <span className="i18n-zh">页面不存在</span>
        </h1>

        <p className="mt-sp3 max-w-xl text-body text-muted">
          <span className="i18n-en">
            The page you&rsquo;re looking for has moved or never existed.
          </span>
          <span className="i18n-zh">你要找的页面可能已经移走，或者从未存在过。</span>
        </p>

        <div className="mt-sp5 flex flex-wrap gap-sp3">
          <Link
            href={localePath("en", "/")}
            className="i18n-en inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent"
          >
            Back to home
          </Link>
          <Link
            href={localePath("zh", "/")}
            className="i18n-zh inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent"
          >
            回到首页
          </Link>

          <Link
            href={localePath("en", "/shop")}
            className="i18n-en inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
          >
            All products
          </Link>
          <Link
            href={localePath("zh", "/shop")}
            className="i18n-zh inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
          >
            全部商品
          </Link>
        </div>
      </div>
    </>
  );
}
