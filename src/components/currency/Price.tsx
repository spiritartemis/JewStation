"use client";

import { convert, formatMoney } from "@/lib/currency";
import { SITE, type Currency } from "@/lib/site";
import { useCurrency } from "./CurrencyProvider";

/**
 * 金额（Q-05 / Q-08）
 *
 * 商品数据里只有美元价（基准币种），这里按当前展示币种换算。
 * 服务端渲染时用的是语言默认币种，保证无 JS 也有价格。
 */
export function Price({
  usd,
  className,
}: {
  /** 美元金额（基准币种原值） */
  usd: number;
  className?: string;
}) {
  const { currency, rate, locale } = useCurrency();
  return <span className={className}>{formatMoney(convert(usd, currency, rate), currency, locale)}</span>;
}

/** 另一种币种的约值：详情页主价下方一行小字，说明这不是结算价 */
export function ApproxPrice({ usd, className }: { usd: number; className?: string }) {
  const { currency, rate, locale } = useCurrency();
  const other: Currency = currency === "USD" ? "CNY" : "USD";
  if (!(SITE.displayCurrencies as readonly string[]).includes(other)) return null;

  return (
    <span className={className}>
      {formatMoney(convert(usd, other, rate), other, locale)}
    </span>
  );
}
