/**
 * 多语言配置（Q-02）
 *
 * 路由口径：
 *  - 英文是**默认语言，不带前缀**：`/shop`、`/products/xxx`
 *  - 中文带 `/zh` 前缀：`/zh/shop`、`/zh/products/xxx`（Q-02 明确：中文页 slug 仍用英文词）
 *  - 英文页在内部由 middleware 重写到 `/en/...`，对外 URL 干净、SEO 不重复
 *
 * 因此**所有站内链接必须过 `localePath()`**，不能直接写 `href="/shop"`，
 * 否则中文页一点就掉回英文页。
 */

export const LOCALES = ["en", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * 语言切换按钮上的文字（0.3.2）：
 * 按钮显示的是**要切去的那个语言**，不是当前语言 ——
 *   中文页显示「English」，点了变英文；英文页显示「中文」，点了变中文。
 * 这样按钮本身就是一句可执行的指令，不需要额外的「切换语言」标签。
 * 长度约束：最长 "English" = 7 字符，按钮按 10 字符预留固定宽度，换语言不跳动。
 */
export const LOCALE_SWITCH_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

/** <html lang>：中文用 zh-CN（目标市场为中国大陆，Q-38） */
export const HTML_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
};

/** OG locale 用下划线格式 */
export const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  zh: "zh_CN",
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * 给站内路径加语言前缀。
 * - `mailto:` / `tel:` / 外链 / 锚点原样返回（不能被加上 /zh）
 * - 默认语言不加前缀
 */
export function localePath(locale: Locale, href: string): string {
  if (!href.startsWith("/")) return href;
  if (locale === DEFAULT_LOCALE) return href;
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}

/** 从真实 URL 里剥掉语言前缀，得到「语言无关路径」 */
export function stripLocale(pathname: string): { locale: Locale; path: string } {
  const seg = pathname.split("/")[1] ?? "";
  if (isLocale(seg) && seg !== DEFAULT_LOCALE) {
    const rest = pathname.slice(seg.length + 1);
    return { locale: seg, path: rest === "" ? "/" : rest };
  }
  // /en/... 是内部重写后的形态，对外不该出现；仍容忍一下
  if (seg === DEFAULT_LOCALE) {
    const rest = pathname.slice(seg.length + 1);
    return { locale: DEFAULT_LOCALE, path: rest === "" ? "/" : rest };
  }
  return { locale: DEFAULT_LOCALE, path: pathname };
}

/** 语言切换器用：把当前地址换到另一种语言，保留 query 与 hash */
export function switchLocale(pathname: string, next: Locale): string {
  const { path } = stripLocale(pathname);
  return localePath(next, path);
}

/** hreflang 表：每页都要给全语言版本，缺一个 Google 就会挑错版本收录 */
export function alternatesFor(path: string) {
  return {
    languages: {
      en: path,
      "zh-CN": localePath("zh", path),
      "x-default": path,
    },
  };
}
