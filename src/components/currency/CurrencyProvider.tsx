"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Locale } from "@/i18n/config";
import { SITE, type Currency } from "@/lib/site";
import { defaultCurrencyFor } from "@/lib/currency";

/**
 * 展示币种状态（Q-05 / Q-08）
 *
 * 币种记在 cookie 里（不是 localStorage）：cookie 后续若接动态渲染，
 * 服务端首屏就能直接按用户选的币种出价；当前整站静态输出，所以先用语言默认值渲染，
 * 挂载后再套用 cookie 里的选择 —— 只影响金额显示，不产生布局跳动。
 *
 * 汇率由服务端注入（每日 0 点刷新，见 lib/currency.ts），这里不重复取数。
 */
type CurrencyState = {
  locale: Locale;
  currency: Currency;
  rate: number;
  fxSource: "boc" | "fallback";
  fxAsOf: string;
  setCurrency: (next: Currency) => void;
};

const COOKIE = "mm_currency";
const CurrencyContext = createContext<CurrencyState | null>(null);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

export function CurrencyProvider({
  locale,
  rate,
  fxSource,
  fxAsOf,
  initialCurrency,
  children,
}: {
  locale: Locale;
  rate: number;
  fxSource: "boc" | "fallback";
  fxAsOf: string;
  /** 服务端读 cookie 得到的初始币种；缺省按语言给默认值 */
  initialCurrency?: Currency;
  children: React.ReactNode;
}) {
  const [currency, setCurrencyState] = useState<Currency>(
    initialCurrency ?? defaultCurrencyFor(locale),
  );

  // 服务端没读到（静态渲染）时，挂载后补一次 cookie 读取
  useEffect(() => {
    if (initialCurrency) return;
    const saved = readCookie(COOKIE);
    if (saved && (SITE.displayCurrencies as readonly string[]).includes(saved)) {
      setCurrencyState(saved as Currency);
    }
  }, [initialCurrency]);

  const setCurrency = useCallback((next: Currency) => {
    setCurrencyState(next);
    document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo(
    () => ({ locale, currency, rate, fxSource, fxAsOf, setCurrency }),
    [locale, currency, rate, fxSource, fxAsOf, setCurrency],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyState {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used inside <CurrencyProvider>");
  return ctx;
}
