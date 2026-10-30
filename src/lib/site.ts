/**
 * 站点级配置（唯一真源）
 *
 * ⚠️ 约定：每次对站点做功能/样式/内容更新并重新发布时，必须同步改动
 * `version` 与 `updatedAt` 两处，二者会直接显示在页脚。不得只改内容不动这两处。
 *
 * 已定稿：brandName / tagline（Q-44）、主币种与展示币种（Q-05 / Q-08）、
 * 配送国家（Q-21）、发货地（Q-30）、税费口径（Q-32）。
 * 待站长给值：supportEmail（Q-47）、包邮门槛（Q-31）、域名（Q-39）。
 */
export const SITE = {
  /** 品牌名（Q-44 已定稿）：Morrow & Muse / 中文「明日缪斯」 */
  brandName: "Morrow & Muse",
  /** 品牌中文名：仅中文页使用（Q-44） */
  brandNameZh: "明日缪斯",
  /** 品牌 Slogan（Q-44 已定稿）：Made for your becoming. / 中文「为你而生」 */
  tagline: "Made for your becoming.",
  taglineZh: "为你而生。",
  /** 结算与标价基准币种（Q-05）：美元。人民币为展示换算 */
  baseCurrency: "USD",
  /** 展示币种（Q-08 双币种）：切换器按这个顺序轮 */
  displayCurrencies: ["USD", "CNY"] as const,
  supportEmail: "hello@example.com",
  /** 站点版本（随每次发布递增） */
  version: "0.3.3-m1b",
  /** 最近更新时间（随每次发布同步）：同日多次发布时带上时刻，保证「更新时间」确实变了 */
  updatedAt: "2026-10-30 18:55",
};

export type Currency = (typeof SITE.displayCurrencies)[number];

/** 配送口径（Q-21 / Q-22 / Q-30 / Q-32），文案与结构化数据共用一处 */
export const SHIPPING = {
  from: "Yiwu, China",
  fromZh: "中国义乌",
  countries: ["US", "CN"],
  processingDays: [1, 2],
  transitDays: [5, 14],
  /** Q-31 满额包邮，门槛待首批定价后反推 —— 未定前不编数字 */
  freeShippingThreshold: null as number | null,
  /** Q-32 价含税 + DDP 我方申报 */
  taxIncluded: true,
  dutyPaid: true,
};
