import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

/**
 * 语言路由（Q-02）
 *
 * 对外 URL：
 *  - 英文（默认）不带前缀：`/`、`/shop`、`/products/xxx`
 *  - 中文带前缀：`/zh`、`/zh/shop`
 *
 * 内部结构是 `app/[locale]/...`，所以无前缀的请求在这里**内部重写**到 `/en/...`，
 * 浏览器地址栏不变、也不会多出一次 301。带前缀的请求直接放行。
 *
 * 附加（2026-11-02）：把判定好的语言写进 `x-locale` 请求头。
 * 404 页拿不到 params，只能靠这个头知道自己该用哪国语言（见 [locale]/not-found.tsx）。
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const segment = pathname.split("/")[1] ?? "";
  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  const headers = new Headers(request.headers);
  headers.set("x-locale", hasLocale ? segment : DEFAULT_LOCALE);

  if (hasLocale) return NextResponse.next({ request: { headers } });

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  /**
   * 跳过：Next 内部资源（_next）、API 路由、以及一切带扩展名的静态文件（/images/x.jpg、/icon.svg…）。
   * 否则重写到 /en/images/... 会 404。
   */
  matcher: ["/((?!_next/|api/|.*\\.[^/]+$).*)"],
};
