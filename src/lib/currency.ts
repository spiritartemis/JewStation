import type { Currency } from "./site";
import type { Locale } from "@/i18n/config";

/**
 * 双币种（Q-05 / Q-08）
 *
 * 口径：
 *  - 商品标价与结算是**美元**（base currency），人民币是**展示换算**，不改商品数据。
 *  - 汇率取**中国银行**外汇牌价「美元现汇卖出价」（客户拿人民币买美元时银行卖出的价，
 *    对「把美元价折成人民币要花多少钱」这个场景最贴近）。
 *  - **每天 0 点（北京时间）刷新一次**：缓存 TTL 取「距下一个北京时间 0 点的秒数」，
 *    因此第一次请求恰好在 0 点后拿到新价，而不是按 24h 滚动。
 *  - 取不到就回退固定汇率并在页面上标注，绝不静默用一个旧数字冒充实时价。
 */

const BOC_URL = "https://www.boc.cn/sourcedb/whpj/index.html";
const FX_TAG = "fx-usd-cny";

/** 兜底汇率：仅在中行页面抓取失败时使用，页面上会明确标注 */
const FALLBACK_RATE = 7.1;

const SH_OFFSET_MS = 8 * 60 * 60 * 1000; // 中国无夏令时，固定 UTC+8

export type FxRate = {
  base: "USD";
  quote: "CNY";
  /** 1 USD = rate CNY */
  rate: number;
  /** 牌价发布时间（北京时间），兜底时为兜底生效日 */
  asOf: string;
  source: "boc" | "fallback";
};

/** 距下一个北京时间 0 点的秒数：作为 fetch 缓存 TTL，实现「每天 0 点刷新」 */
export function secondsUntilMidnightBeijing(now = Date.now()): number {
  const sh = new Date(now + SH_OFFSET_MS);
  const nextMidnightUtc =
    Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate() + 1, 0, 0, 0) - SH_OFFSET_MS;
  return Math.max(60, Math.floor((nextMidnightUtc - now) / 1000));
}

/**
 * 从中国银行牌价页解析美元现汇卖出价。
 * 页面结构：<tr data-currency='美元'> 后跟 8 个 td：
 *   0 货币名 / 1 现汇买入 / 2 现钞买入 / 3 现汇卖出 / 4 现钞卖出 / 5 中行折算价 / 6 发布时间 / 7 时间
 * 牌价单位是「每 100 美元」，所以要除以 100。
 * 注意 5 是折算价（也是一个数字），别把它当时间。
 */
export function parseBocHtml(html: string): { rate: number; asOf: string } | null {
  const row = html.match(/<tr[^>]*data-currency=['"]美元['"][^>]*>([\s\S]*?)<\/tr>/);
  if (!row) return null;

  const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
  const sell = Number.parseFloat(cells[3] ?? "");
  if (!Number.isFinite(sell) || sell <= 0) return null;

  return { rate: sell / 100, asOf: cells[6] || "" };
}

function fallbackRate(): FxRate {
  return {
    base: "USD",
    quote: "CNY",
    rate: FALLBACK_RATE,
    asOf: new Date().toISOString().slice(0, 10),
    source: "fallback",
  };
}

/** 取当日美元兑人民币展示汇率（带 0 点过期的缓存） */
export async function getUsdCnyRate(): Promise<FxRate> {
  try {
    const res = await fetch(BOC_URL, {
      headers: {
        // 中行站点对无 UA 的请求返回空白页
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "accept-language": "zh-CN,zh;q=0.9",
      },
      next: { revalidate: secondsUntilMidnightBeijing(), tags: [FX_TAG] },
    });
    if (!res.ok) return fallbackRate();

    const parsed = parseBocHtml(await res.text());
    if (!parsed) return fallbackRate();

    return {
      base: "USD",
      quote: "CNY",
      rate: Math.round(parsed.rate * 10000) / 10000,
      asOf: parsed.asOf,
      source: "boc",
    };
  } catch {
    // 构建期或断网时不阻断页面：回退固定汇率，页面上会标注
    return fallbackRate();
  }
}

/** 换算到展示币种（美元即原值） */
export function convert(usd: number, currency: Currency, rate: number): number {
  return currency === "USD" ? usd : usd * rate;
}

/**
 * 金额格式化。
 * `narrowSymbol` 让人民币在英文页面也显示成 ¥346.13，而不是 CN¥346.13。
 */
export function formatMoney(amount: number, currency: Currency, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** 默认展示币种：中文站先给人民币，英文站先给美元（Q-08） */
export function defaultCurrencyFor(locale: Locale): Currency {
  return locale === "zh" ? "CNY" : "USD";
}
