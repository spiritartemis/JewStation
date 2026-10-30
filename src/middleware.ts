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
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  /**
   * 跳过：Next 内部资源（_next）、API 路由、以及一切带扩展名的静态文件（/images/x.jpg、/icon.svg…）。
   * 否则重写到 /en/images/... 会 404。
   */
  matcher: ["/((?!_next/|api/|.*\\.[^/]+$).*)"],
};
