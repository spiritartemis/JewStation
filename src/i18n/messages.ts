/**
 * 界面词条（Q-02 中英双语）
 *
 * 口径：
 *  - `en` 是英文底稿（工程侧出），`zh` 是中文稿（初翻 + 品牌口吻校对，**待站长审**）。
 *  - 只有**界面与固定文案**放这里；商品数据自带 `i18n.zh` 覆盖，长文（About/FAQ/政策）在 `content.ts`。
 *  - 所有站内 href 在这里写「语言无关路径」，渲染时统一过 `localePath()`。
 */

const en = {
  common: {
    skipToContent: "Skip to content",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    menu: "Menu",
    home: "Home",
    viewAll: "View all",
    clear: "Clear",
    notSpecified: "Not specified",
    pending: "Pending owner decision",
  },
  nav: {
    shop: "Shop",
    oneOfAKind: "One of a Kind",
    about: "About",
    faq: "FAQ",
    allProducts: "All products",
    newArrivals: "New arrivals",
    restockable: "Restockable",
    category: "Category",
    style: "Style",
    more: "More",
    search: "Search",
    cart: "Cart",
    cartAria: "Cart, empty",
  },
  footer: {
    groups: [
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
          { label: "Contact us", href: "mailto:{email}" },
        ],
      },
      {
        title: "About",
        items: [
          { label: "Our story", href: "/about" },
          { label: "Materials & care", href: "/faq#care" },
        ],
      },
      {
        title: "Legal",
        items: [
          { label: "Privacy policy", href: "/policies/privacy" },
          { label: "Cookie policy", href: "/policies/cookies" },
          { label: "Terms & conditions", href: "/policies/terms" },
        ],
      },
    ],
    newsletterTitle: "Newsletter",
    emailPlaceholder: "Email address",
    join: "Join",
    newsletterNote: "Newsletter launches with V1.0 — this slot is a placeholder.",
    versionLabel: "Version",
    updatedLabel: "Updated",
  },
  home: {
    sections: {
      newArrivals: "New arrivals",
      oneOfAKind: "One of a Kind",
      oneOfAKindNote: "Each piece is made once — photographed as the exact one you'll receive.",
      trending: "Trending",
      youMayLike: "You may like",
      byStyle: "Shop by style",
    },
  },
  list: {
    allProducts: "All products",
    countOf: (shown: number, total: number) => `${shown} of ${total} products`,
    countOnly: (n: number) => `${n} product${n === 1 ? "" : "s"}`,
    noMatch: "No products match these filters.",
    clearFilters: "Clear filters",
    filter: "Filter",
    filters: "Filters",
    closeFilters: "Close filters",
    clear: "Clear",
    showResults: (n: number) => `Show ${n} result${n === 1 ? "" : "s"}`,
    sortAria: "Sort products",
    removeFilter: (label: string) => `Remove filter ${label}`,
    clearAll: (n: number) => `Clear all (${n})`,
    groupTitles: {
      category: "Category",
      style: "Style",
      material: "Material",
      type: "Type",
      price: "Price",
    },
    sort: {
      newest: "Newest",
      "price-asc": "Price: low to high",
      "price-desc": "Price: high to low",
    },
    priceBuckets: {
      "under-50": "Under $50",
      "50-100": "$50 – $100",
      "over-100": "Over $100",
    },
  },
  product: {
    oneOfAKindBadge: "One of a Kind",
    sold: "Sold",
    outOfStock: "Out of stock",
    onlyLeft: (n: number) => `Only ${n} left`,
    photoPending: "Photo pending",
    material: "Material",
    size: "Size",
    weight: "Weight",
    closure: "Closure",
    sizes: "Sizes",
    care: "Care",
    dimensionUnit: "mm",
    addToCart: "Add to cart",
    soldNote: "This piece has been sold. One-of-a-kind items are not restocked.",
    outOfStockNote: "Out of stock right now — this style is restocked, check back soon.",
    checkoutNote: "Cart and checkout open with V0.3 (m-1c).",
    shippingReturns: "Shipping & returns",
    shippingSummary: "Ships from Yiwu, China · 1–2 days processing + 5–14 days in transit · Prices include tax (DDP)",
    earringsFinalSale: "Earrings are final sale unless faulty (hygiene).",
    categoryLabel: "Category",
    styleLabel: "Style",
    similar: "Similar style",
    similarNote: "Personalised recommendations arrive with V1.0; showing same category for now.",
    options: "Options",
    breadcrumb: "Breadcrumb",
  },
  search: {
    title: "Search",
    placeholder: "Search earrings, silver, pearl…",
    submit: "Search",
    tryLabel: "Try",
    hint: "Try a product name, material or style — for example “hoops”, “silver” or “minimal”.",
    resultsFor: (n: number, q: string) => `${n} result${n === 1 ? "" : "s"} for “${q}”`,
    clearSearch: "Clear search",
    noResults: "No results",
    noResultsHint: (q: string) =>
      `Nothing matches “${q}”. Try a shorter word, or browse all products.`,
    browseAll: "Browse all products",
    labelAria: "Search products",
  },
  cart: {
    title: "Your bag is empty",
    description: "Bag, checkout and order confirmation are implemented in m-1c.",
    browseAll: "Browse all products",
  },
  currency: {
    switchAria: "Display currency",
    usd: "USD",
    cny: "CNY",
    approx: (value: string) => `≈ ${value}`,
    rateNote: (rate: string, asOf: string) => `1 USD = ${rate} CNY · BOC reference rate, ${asOf}`,
    rateFallback: "Reference rate unavailable — showing a fixed fallback rate.",
  },
  language: {
    switchAria: "Language",
    label: "Language",
  },
  policy: {
    draftNotice: "Draft — pending business/legal review. Not for publication until approved.",
    lastUpdated: "Last updated",
  },
  notFound: {
    title: "Page not found",
    description: "The page you're looking for has moved or never existed.",
    backHome: "Back to home",
  },
};

/**
 * 中文稿：结构必须与 en 完全一致（少一个键 tsc 就报错，避免中文页漏词）。
 * 注意 en 不能加 `as const`：加了会把类型收窄成字面量，中文稿就只能是同样的英文句子。
 */
type Messages = typeof en;

const zh: Messages = {
  common: {
    skipToContent: "跳到正文",
    openMenu: "打开菜单",
    closeMenu: "关闭菜单",
    menu: "菜单",
    home: "首页",
    viewAll: "查看全部",
    clear: "清除",
    notSpecified: "未标注",
    pending: "待站长确认",
  },
  nav: {
    shop: "选购",
    oneOfAKind: "孤品",
    about: "关于我们",
    faq: "常见问题",
    allProducts: "全部商品",
    newArrivals: "新品",
    restockable: "可补货",
    category: "品类",
    style: "风格",
    more: "更多",
    search: "搜索",
    cart: "购物袋",
    cartAria: "购物袋，空的",
  },
  footer: {
    groups: [
      {
        title: "选购",
        items: [
          { label: "全部商品", href: "/shop" },
          { label: "新品", href: "/collections/new" },
          { label: "孤品", href: "/collections/one-of-a-kind" },
          { label: "可补货", href: "/collections/restockable" },
        ],
      },
      {
        title: "帮助",
        items: [
          { label: "常见问题", href: "/faq" },
          { label: "配送说明", href: "/policies/shipping" },
          { label: "退换说明", href: "/policies/returns" },
          { label: "联系我们", href: "mailto:{email}" },
        ],
      },
      {
        title: "关于",
        items: [
          { label: "品牌故事", href: "/about" },
          { label: "材质与保养", href: "/faq#care" },
        ],
      },
      {
        title: "条款",
        items: [
          { label: "隐私政策", href: "/policies/privacy" },
          { label: "Cookie 政策", href: "/policies/cookies" },
          { label: "条款与条件", href: "/policies/terms" },
        ],
      },
    ],
    newsletterTitle: "订阅",
    emailPlaceholder: "邮箱地址",
    join: "订阅",
    newsletterNote: "订阅功能随 V1.0 上线，此处为占位。",
    versionLabel: "版本",
    updatedLabel: "更新",
  },
  home: {
    sections: {
      newArrivals: "新品",
      oneOfAKind: "孤品",
      oneOfAKindNote: "每一件只做一次 —— 拍下的就是你收到的那一件。",
      trending: "当季热门",
      youMayLike: "你可能会喜欢",
      byStyle: "按风格选购",
    },
  },
  list: {
    allProducts: "全部商品",
    countOf: (shown: number, total: number) => `共 ${total} 件，当前显示 ${shown} 件`,
    countOnly: (n: number) => `共 ${n} 件`,
    noMatch: "没有符合当前筛选条件的商品。",
    clearFilters: "清除筛选",
    filter: "筛选",
    filters: "筛选",
    closeFilters: "关闭筛选",
    clear: "清除",
    showResults: (n: number) => `查看 ${n} 件结果`,
    sortAria: "商品排序",
    removeFilter: (label: string) => `移除筛选：${label}`,
    clearAll: (n: number) => `全部清除（${n}）`,
    groupTitles: {
      category: "品类",
      style: "风格",
      material: "材质",
      type: "类型",
      price: "价格",
    },
    sort: {
      newest: "最新上架",
      "price-asc": "价格从低到高",
      "price-desc": "价格从高到低",
    },
    priceBuckets: {
      "under-50": "$50 以下",
      "50-100": "$50 – $100",
      "over-100": "$100 以上",
    },
  },
  product: {
    oneOfAKindBadge: "孤品",
    sold: "已售出",
    outOfStock: "暂时缺货",
    onlyLeft: (n: number) => `仅剩 ${n} 件`,
    photoPending: "待补图",
    material: "材质",
    size: "尺寸",
    weight: "重量",
    closure: "开合方式",
    sizes: "可选尺寸",
    care: "保养",
    dimensionUnit: "mm",
    addToCart: "加入购物袋",
    soldNote: "这件已经售出，孤品不再补货。",
    outOfStockNote: "暂时缺货——这款会补货，可以过几天再来看看。",
    checkoutNote: "购物袋与结账随 V0.3（m-1c）开放。",
    shippingReturns: "配送与退换",
    shippingSummary: "中国义乌发货 · 备货 1–2 天 + 在途 5–14 天 · 售价已含税（DDP）",
    earringsFinalSale: "耳饰非质量问题不接受退货（卫生原因）。",
    categoryLabel: "品类",
    styleLabel: "风格",
    similar: "相似风格",
    similarNote: "个性化推荐随 V1.0 上线，当前先展示同品类商品。",
    options: "规格",
    breadcrumb: "面包屑导航",
  },
  search: {
    title: "搜索",
    placeholder: "搜索耳环、银饰、珍珠…",
    submit: "搜索",
    tryLabel: "试试",
    hint: "可以搜商品名、材质或风格 —— 例如「耳环」「纯银」「极简」。",
    resultsFor: (n: number, q: string) => `「${q}」共 ${n} 条结果`,
    clearSearch: "清空搜索",
    noResults: "没有找到",
    noResultsHint: (q: string) => `没有匹配「${q}」的商品，换个更短的词，或浏览全部商品。`,
    browseAll: "浏览全部商品",
    labelAria: "搜索商品",
  },
  cart: {
    title: "购物袋是空的",
    description: "购物袋、结账与订单确认将在 m-1c 实现。",
    browseAll: "浏览全部商品",
  },
  currency: {
    switchAria: "显示币种",
    usd: "美元",
    cny: "人民币",
    approx: (value: string) => `约 ${value}`,
    rateNote: (rate: string, asOf: string) => `1 美元 = ${rate} 元人民币 · 中国银行参考价，${asOf}`,
    rateFallback: "暂未取到当日中间价，正在使用固定备用汇率。",
  },
  language: {
    switchAria: "语言",
    label: "语言",
  },
  policy: {
    draftNotice: "初稿 —— 待业务/法务复核。未通过前不得对外发布。",
    lastUpdated: "最近更新",
  },
  notFound: {
    title: "页面不存在",
    description: "你要找的页面可能已经移走，或者从未存在过。",
    backHome: "回到首页",
  },
};

export const messages = { en, zh };
export type { Messages };
export function getMessages(locale: keyof typeof messages): Messages {
  return messages[locale];
}
