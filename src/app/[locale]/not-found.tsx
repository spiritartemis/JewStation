import Link from "next/link";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 404
 *
 * 为什么不用 usePathname：not-found 一旦写成客户端组件，**服务端就不渲染这段内容**，
 * 页面只剩顶栏页脚、状态码还会掉成 200（爬虫看到的是"空页可索引"）。所以这里必须是服务端组件。
 *
 * 语言从 middleware 注入的 `x-locale` 头取（见 src/middleware.ts）：
 * 中间件本来就为每个请求判定过语言，顺手写进请求头，404 页就不用再猜。
 */
export default async function NotFound() {
  const store = await headers();
  const raw = store.get("x-locale") ?? DEFAULT_LOCALE;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const m = getMessages(locale);

  return (
    <div className="shell py-sp6">
      <h1 className="font-serif text-h1 text-ink">404 · {m.notFound.title}</h1>
      <p className="mt-sp3 text-body text-muted">{m.notFound.description}</p>
      <div className="mt-sp5 flex flex-wrap gap-sp3">
        <Link
          href={localePath(locale, "/")}
          className="inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent"
        >
          {m.notFound.backHome}
        </Link>
        <Link
          href={localePath(locale, "/shop")}
          className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
        >
          {m.list.allProducts}
        </Link>
      </div>
    </div>
  );
}
