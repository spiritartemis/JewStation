"use client";

import { SITE, type Currency } from "@/lib/site";
import { useCurrency } from "./CurrencyProvider";

/**
 * 币种切换（Q-08 双币种）
 *
 * 刻意的克制：不做成下拉菜单。只有两个币种时，两段式开关一眼能看懂现在是哪个，
 * 也不占顶栏高度。汇率说明放 title/aria，不占版面。
 */
export function CurrencySwitcher({ className = "" }: { className?: string }) {
  const { currency, setCurrency, rate, fxSource, fxAsOf, locale } = useCurrency();

  const note =
    fxSource === "boc"
      ? `1 USD = ${rate} CNY · ${asOf(fxAsOf)}`
      : locale === "zh"
        ? "暂未取到中国银行当日牌价，使用固定备用汇率"
        : "BOC rate unavailable — using a fixed fallback rate";

  return (
    <div
      className={`flex items-center rounded-btn border border-line p-[2px] ${className}`}
      title={note}
      role="group"
      aria-label={locale === "zh" ? "显示币种" : "Display currency"}
    >
      {SITE.displayCurrencies.map((c: Currency) => {
        const active = c === currency;
        return (
          <button
            key={c}
            type="button"
            onClick={() => setCurrency(c)}
            aria-pressed={active}
            className={`h-7 rounded-[6px] px-sp2 text-[11px] uppercase tracking-[0.08em] transition-colors duration-fade ${
              active ? "bg-ink text-bg" : "text-muted hover:text-ink"
            }`}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}

/** 中行牌价的北京时间只到分钟，展示到日期即可（每日 0 点才变） */
function asOf(raw: string): string {
  const m = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

/** 页脚用的汇率说明：一行字，把来源、取数时间、结算币种都讲清楚 */
export function FxNote({ className = "" }: { className?: string }) {
  const { rate, fxSource, fxAsOf, locale, currency } = useCurrency();
  const zh = locale === "zh";

  return (
    <p className={className}>
      {fxSource === "boc"
        ? zh
          ? `汇率：1 美元 = ${rate} 元人民币（中国银行 ${asOf(fxAsOf)} 牌价，每日 0 点更新）`
          : `Rate: 1 USD = ${rate} CNY (Bank of China, ${asOf(fxAsOf)}, refreshed daily)`
        : zh
          ? "汇率暂不可用，正在使用固定备用值。"
          : "Rate unavailable — using a fixed fallback."}
      {" · "}
      {zh
        ? `展示币种 ${currency}，结算以结账页为准。`
        : `Showing ${currency}; settlement currency is confirmed at checkout.`}
    </p>
  );
}
