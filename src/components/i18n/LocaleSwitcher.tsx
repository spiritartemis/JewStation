"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LOCALE_LABELS, LOCALES, switchLocale, type Locale } from "@/i18n/config";

/**
 * 语言切换（Q-02）
 *
 * 用真实 <a> 而不是客户端路由跳转：语言切换本质是换一份文档，
 * 整页刷新反而更稳（字体、lang 属性、hreflang 都跟着变）。
 * query 在挂载后补进 href，这样在 /shop?category=rings 上切换语言不会丢筛选。
 */
export function LocaleSwitcher({
  current,
  className = "",
}: {
  current: Locale;
  className?: string;
}) {
  const pathname = usePathname() || "/";
  const [search, setSearch] = useState("");

  useEffect(() => {
    setSearch(window.location.search);
  }, [pathname]);

  return (
    <div
      className={`flex items-center gap-sp2 text-[11px] uppercase tracking-[0.08em] ${className}`}
      aria-label={current === "zh" ? "语言" : "Language"}
      role="group"
    >
      {LOCALES.map((locale) => {
        const active = locale === current;
        if (active) {
          return (
            <span key={locale} aria-current="true" className="text-ink">
              {LOCALE_LABELS[locale]}
            </span>
          );
        }
        return (
          <a
            key={locale}
            href={`${switchLocale(pathname, locale)}${search}`}
            hrefLang={locale === "zh" ? "zh-CN" : "en"}
            className="text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            {LOCALE_LABELS[locale]}
          </a>
        );
      })}
    </div>
  );
}
