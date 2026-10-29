/**
 * 站点级配置（唯一真源）
 *
 * ⚠️ 约定：每次对站点做功能/样式/内容更新并重新发布时，必须同步改动
 * `version` 与 `updatedAt` 两处，二者会直接显示在页脚。不得只改内容不动这两处。
 *
 * 待站长确认项（见 docs/V0.1-待站长确认问题清单.md）：
 *  - currency：Q-05（主币种与目标市场）
 *  - supportEmail：Q-33（客服邮箱）
 * 已定稿：brandName / tagline —— Q-44（2026-10-29 站长给出）
 */
export const SITE = {
  /** 品牌名（Q-44 已定稿）：Morrow & Muse / 中文「明日缪斯」 */
  brandName: "Morrow & Muse",
  /** 品牌 Slogan（Q-44 已定稿）：Made for your becoming. / 中文「为你而生」 */
  tagline: "Made for your becoming.",
  locale: "en",
  currency: "USD",
  supportEmail: "hello@example.com",
  /** 站点版本（随每次发布递增） */
  version: "0.2.9-m1b",
  /** 最近更新时间（随每次发布同步） */
  updatedAt: "2026-10-29",
} as const;

export type NavItem = { label: string; href: string };

/** 品类导航（与 03-标签字典 §2 同源，slug 即集合页路径） */
export const CATEGORY_NAV: NavItem[] = [
  { label: "Earrings", href: "/collections/earrings" },
  { label: "Necklaces", href: "/collections/necklaces" },
  { label: "Rings", href: "/collections/rings" },
  { label: "Bracelets", href: "/collections/bracelets" },
];

/** 抽屉里的风格入口（03 §3 标准值；抽屉只放三个，全部风格见 STYLE_TAGS） */
export const STYLE_NAV: NavItem[] = [
  { label: "Minimal", href: "/collections/minimal" },
  { label: "Vintage", href: "/collections/vintage" },
  { label: "Statement", href: "/collections/statement" },
];

/** 桌面端横向主导航（01 §3.2） */
export const DESKTOP_NAV: NavItem[] = [
  { label: "Shop", href: "/shop" },
  { label: "One of a Kind", href: "/collections/one-of-a-kind" },
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/faq" },
];

export type FooterGroup = { title: string; items: NavItem[] };

/** 页脚分组（01 §3.3）：政策页不进主导航，只出现在页脚与结账/同意条 */
export const FOOTER_GROUPS: FooterGroup[] = [
  {
    title: "Shop",
    items: [
      { label: "All products", href: "/shop" },
      { label: "New arrivals", href: "/collections/new" },
      { label: "One of a Kind", href: "/collections/one-of-a-kind" },
      { label: "Restockable", href: "/collections/restockable" },
    ],
  },
  {
    title: "Help",
    items: [
      { label: "FAQ", href: "/faq" },
      { label: "Shipping", href: "/policies/shipping" },
      { label: "Returns", href: "/policies/returns" },
      // 联系客服用邮箱代替联系表单页（01 §2 明确不做联系表单页）
      { label: "Contact us", href: `mailto:${SITE.supportEmail}` },
    ],
  },
  {
    title: "About",
    items: [
      { label: "Our story", href: "/about" },
      // Q-03 未定：材质与保养是否单开内容页；未定前指向 FAQ 锚点
      { label: "Materials & care", href: "/faq#care" },
    ],
  },
  {
    title: "Legal",
    items: [
      { label: "Privacy policy", href: "/policies/privacy" },
      { label: "Cookie policy", href: "/policies/cookies" },
      // Q-01 未定：是否需要条款页（部分市场/支付商要求）；定稿前不列
    ],
  },
];
