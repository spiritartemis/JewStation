"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LOCALE_SWITCH_LABELS, switchLocale, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 语言切换（Q-02；0.3.2 改成右上角单按钮）
 *
 * 形态：一枚固定宽度的按钮，按钮文字 = **要切去的那个语言**
 *   中文页 →「English」，点了变英文；英文页 →「中文」，点了变中文。
 *   按钮宽度按 10 字符预留（最长文案 "English" 7 字符），中文两字时不缩宽，
 *   所以来回切换按钮不会跳动。
 *
 * 用真实 <a> 而不是客户端跳转：语言切换本质是换一份文档，整页刷新更稳
 * （字体、<html lang>、hreflang 都跟着变），也符合「点击后页面刷新成英文 / 中文」。
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
  const m = getMessages(current);

  useEffect(() => {
    setSearch(window.location.search);
  }, [pathname]);

  // 目标语言 = 与当前相反的那个；按钮上写目标语言的名字
  const target: Locale = current === "zh" ? "en" : "zh";

  return (
    <a
      href={`${switchLocale(pathname, target)}${search}`}
      hrefLang={target === "zh" ? "zh-CN" : "en"}
      aria-label={m.language.switchTo}
      title={m.language.switchTo}
      className={`inline-flex h-8 w-[64px] shrink-0 items-center justify-center rounded-full border border-line px-sp1 text-[11px] leading-none text-ink transition-colors duration-fade whitespace-nowrap hover:border-accent hover:text-accent lg:w-[76px] ${className}`}
    >
      {LOCALE_SWITCH_LABELS[target]}
    </a>
  );
}
