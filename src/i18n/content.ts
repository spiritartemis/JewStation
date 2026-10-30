import type { Doc } from "@/content/types";
import type { Locale } from "./config";

/**
 * 长文内容源（中英双语）
 *
 * 口径（Q-02）：英文是底稿，中文是「初翻 + 品牌口吻校对」稿，**待站长审**。
 * 已确认的业务口径（Q-21 / Q-22 / Q-30 / Q-31 / Q-32 / Q-13 / Q-23 / Q-28 / Q-29）已写进正文；
 * 仍缺值的（Q-09 逐款含镍、Q-24~Q-27 法律文本、Q-47 客服邮箱）保留待确认标记，不编造。
 */

export type FaqItem = { id: string; question: string; answer: string; pending?: string };

export type Hero = {
  eyebrow: string;
  headline: string;
  headlineAccent: string;
  ctaLabel: string;
  ctaHref: string;
  imageUrl: string;
  imageAlt: string;
  imagePendingNote: string;
};

export type SiteContent = {
  hero: Hero;
  about: Doc;
  faq: FaqItem[];
  policies: Doc[];
};

/** 深色莫兰迪版改用深色石板主图（hero-home.jpg）；浅色版用的 hero-home-light.jpg 保留备查 */
const IMAGE_URL = "/images/hero-home.jpg";

const en: SiteContent = {
  hero: {
    eyebrow: "Morrow & Muse",
    headline: "Made for your",
    headlineAccent: "becoming.",
    ctaLabel: "Shop new",
    ctaHref: "/collections/new",
    imageUrl: IMAGE_URL,
    imageAlt:
      "Two polished silver huggie hoops, a fine silver chain with a small round pendant and a single baroque pearl stud, resting on a warm off-white plaster surface in soft window light.",
    imagePendingNote: "Hero photo pending",
  },
  about: {
    slug: "about",
    title: "About",
    status: "draft",
    updatedAt: "2026-10-30",
    blocks: [
      {
        type: "p",
        text: "Morrow is what's coming. Muse is what moves you. Morrow & Muse makes small-batch jewellery for the person you're becoming — pieces you keep on, not put away.",
      },
      {
        type: "p",
        text: "Some pieces are hand-formed one at a time, others are produced in limited runs. Both are made to be worn every day, not kept in a box.",
      },
      { type: "h", text: "Handmade means variation" },
      {
        type: "p",
        text: "Hand-formed pieces are never identical. Small differences in curve, hammer marks and surface are part of the piece, not a fault. We photograph the actual piece you will receive for one-of-a-kind items.",
      },
      { type: "h", text: "Materials" },
      {
        type: "p",
        text: "We state the actual material of every piece — metal, purity and plating — on each product page. Natural stones and pearls vary in colour and shape by nature.",
      },
      { type: "h", text: "Where we ship from" },
      {
        type: "p",
        text: "Orders leave from Yiwu, China. Cross-border parcels go out through a global carrier, and domestic China orders ship with a local courier. Every price shown already includes tax.",
      },
      {
        type: "note",
        text: "Pending (Q-44): studio location, founder story and brand history to be supplied by the owner. Brand name and tagline were finalised on 2026-10-29.",
      },
    ],
  },
  faq: [
    {
      id: "shipping-time",
      question: "When will my order ship?",
      answer:
        "Orders are packed in 1–2 business days, then take 5–14 days in transit. Cross-border parcels ship from Yiwu, China; the tracking number is sent once the parcel is handed to the carrier.",
    },
    {
      id: "shipping-countries",
      question: "Which countries do you ship to?",
      answer: "We currently ship to the United States and mainland China only. More regions are added later.",
    },
    {
      id: "shipping-cost",
      question: "How much is shipping?",
      answer:
        "Shipping is free above an order threshold. The threshold is set once first-collection pricing is final and will be published on this page before launch; orders below it pay one flat rate by destination.",
    },
    {
      id: "customs",
      question: "Will I pay customs or import tax?",
      answer:
        "The price you see already includes tax. Cross-border orders are shipped DDP — we declare and pre-pay on your behalf, so nothing extra is collected on delivery. Orders inside mainland China are not taxed again.",
    },
    {
      id: "returns",
      question: "Can I return an item?",
      answer:
        "You have 14 days from delivery. Refunds are issued 3–5 business days after we receive and check the piece. Earrings cannot be returned for hygiene reasons unless faulty. One-of-a-kind pieces can only be returned if faulty — and once returned they go back on sale as they are.",
    },
    {
      id: "restock",
      question: "Do you remake one-of-a-kind pieces?",
      answer:
        "No. One of a Kind pieces exist once. Once sold, they are marked Sold and the listing is kept as a record — it cannot be reproduced.",
    },
    {
      id: "handmade-variation",
      question: "Will my piece look exactly like the photo?",
      answer:
        "For hand-formed pieces, close but not identical: curves, hammer marks and surface finish differ slightly by hand. Natural stones and pearls vary in colour and shape.",
    },
    {
      id: "nickel",
      question: "Is your jewellery nickel-free?",
      answer:
        "It depends on the piece: the actual metal, purity and plating are stated on every product page, and any piece that may contain nickel is flagged in its allergy notice. We never use unfounded claims such as “hypoallergenic” or “never tarnishes”.",
      pending: "Q-09 per-piece nickel list — owner to confirm piece by piece",
    },
    {
      id: "care",
      question: "How do I care for my jewellery?",
      answer:
        "Keep pieces away from water, perfume and cleaning chemicals; store them in the supplied pouch. Silver will oxidise and brass will patina over time — both are normal and can be polished.",
    },
    {
      id: "order-change",
      question: "Can I change or cancel my order?",
      answer:
        "Write to us as soon as you can — orders can be changed or cancelled before they are dispatched. Once a parcel is with the carrier, please use the returns process instead.",
      pending: "Q-47 support email domain",
    },
  ],
  policies: [
    {
      slug: "privacy",
      title: "Privacy policy",
      status: "pending_review",
      updatedAt: "2026-10-27",
      blocks: [
        {
          type: "note",
          text: "Unreviewed draft: this policy must match the real data flows behind the cookie banner and be reviewed by someone familiar with the target markets' rules before publication.",
        },
        { type: "h", text: "What we collect" },
        { type: "p", text: "To be completed: order details, contact details, payment information (handled by the payment provider — card numbers are never stored on this site)." },
        { type: "h", text: "How we use it" },
        { type: "p", text: "To be completed: fulfilling orders, customer support, legal obligations; marketing only with separate consent." },
        { type: "h", text: "Who we share it with" },
        { type: "p", text: "To be completed: payment provider, carrier, email provider (listed once Q-34 / Q-35 / Q-36 are settled)." },
        { type: "h", text: "How long we keep it" },
        { type: "p", text: "To be completed: retention period and deletion triggers." },
        { type: "h", text: "Your rights" },
        { type: "p", text: "To be completed: how to access, correct or delete your data and withdraw consent, and how fast we respond." },
        { type: "h", text: "Contact" },
        { type: "p", text: "Pending (Q-47): support email to be supplied by the owner." },
      ],
    },
    {
      slug: "cookies",
      title: "Cookie policy",
      status: "pending_review",
      updatedAt: "2026-10-27",
      blocks: [
        {
          type: "note",
          text: "Unreviewed draft: every cookie category must map to something actually running; tracking requires separate, withdrawable consent.",
        },
        { type: "h", text: "Strictly necessary" },
        { type: "p", text: "Required for the bag, checkout and security. No consent needed." },
        { type: "h", text: "Analytics" },
        { type: "p", text: "To be completed: no third-party analytics in V0.1 (see technical boundaries); anything added must be listed here and consented to." },
        { type: "h", text: "Marketing" },
        { type: "p", text: "To be completed: personalisation and ads, enabled only with separate consent (m-1d)." },
      ],
    },
    {
      slug: "returns",
      title: "Returns & exchanges",
      status: "pending_review",
      updatedAt: "2026-10-30",
      blocks: [
        { type: "h", text: "Return window" },
        { type: "p", text: "14 days from the day the parcel is delivered." },
        { type: "h", text: "Condition" },
        { type: "p", text: "The piece must come back unworn and in its original packaging. We check every return before refunding." },
        { type: "h", text: "Earrings" },
        { type: "p", text: "For hygiene reasons earrings cannot be returned unless they are faulty." },
        { type: "h", text: "One of a Kind" },
        { type: "p", text: "One-of-a-kind pieces can only be returned if faulty. A returned piece goes back on sale exactly as it is — it is not remade." },
        { type: "h", text: "Refunds" },
        { type: "p", text: "Refunds are issued 3–5 business days after the returned piece is received and checked, back to the original payment method." },
        { type: "h", text: "How to start a return" },
        { type: "p", text: "Write to us with your order number and a photo of the piece. Support email is pending owner confirmation (Q-47)." },
      ],
    },
    {
      slug: "shipping",
      title: "Shipping",
      status: "pending_review",
      updatedAt: "2026-10-30",
      blocks: [
        { type: "h", text: "Where we ship from" },
        { type: "p", text: "Every order leaves from Yiwu, China." },
        { type: "h", text: "Where we ship to" },
        { type: "p", text: "The United States and mainland China. More regions will be added later." },
        { type: "h", text: "Delivery times" },
        { type: "p", text: "Two stages: 1–2 business days to pack your order, then 5–14 days in transit. Cross-border parcels go through a global carrier; domestic China orders ship with a local courier." },
        { type: "h", text: "Rates" },
        { type: "p", text: "Shipping is free above an order threshold, published here before launch once first-collection pricing is final. Below the threshold one flat rate applies by destination — we do not use live carrier quotes, so the price you see at checkout is final." },
        { type: "h", text: "Tax and customs" },
        { type: "p", text: "Prices include tax. Cross-border orders ship DDP: we declare and pre-pay duties, so nothing extra is collected at your door. Orders inside mainland China are not taxed or declared again." },
      ],
    },
    {
      slug: "terms",
      title: "Terms & conditions",
      status: "pending_review",
      updatedAt: "2026-10-30",
      blocks: [
        {
          type: "note",
          text: "Unreviewed draft: commercial terms (governing law, liability, dispute route) to be supplied by the owner by 2026-11-06 and reviewed by legal before publication.",
        },
        { type: "h", text: "Using this site" },
        { type: "p", text: "By browsing or ordering you agree to these terms. Product photos, copy and the brand mark belong to Morrow & Muse and may not be reused commercially." },
        { type: "h", text: "Orders and pricing" },
        { type: "p", text: "An order is a request to buy; the contract forms when we accept it and confirm dispatch. Prices are shown in USD and CNY, include tax, and are converted for display only — settlement currency is confirmed at checkout." },
        { type: "h", text: "Availability" },
        { type: "p", text: "One-of-a-kind pieces exist once. If a piece sells out between your order and dispatch we cancel and refund that line in full." },
        { type: "h", text: "Returns and refunds" },
        { type: "p", text: "Returns follow the Returns & exchanges policy: 14 days, unworn, earrings excluded for hygiene, one-of-a-kind only if faulty." },
        { type: "h", text: "To be completed" },
        { type: "p", text: "Pending: governing law, liability limits, complaint route, and the legal entity behind the store (Q-24 / Q-34)." },
      ],
    },
  ],
};

const zh: SiteContent = {
  hero: {
    eyebrow: "Morrow & Muse · 明日缪斯",
    headline: "为你",
    headlineAccent: "而生。",
    ctaLabel: "看新品",
    ctaHref: "/collections/new",
    imageUrl: IMAGE_URL,
    imageAlt:
      "两枚抛光的银色耳扣、一条带小圆坠的细银链、一颗巴洛克珍珠耳钉，摆在暖白石膏面上，窗光柔和。",
    imagePendingNote: "主图待补",
  },
  about: {
    slug: "about",
    title: "关于我们",
    status: "draft",
    updatedAt: "2026-10-30",
    blocks: [
      {
        type: "p",
        text: "Morrow 是尚未到来的明天，Muse 是打动你的那点灵感。Morrow & Muse 做小批量首饰，为正在成为的你——是戴在身上不摘下来的那种，不是收进盒子里的那种。",
      },
      {
        type: "p",
        text: "有的款式一件一件手作成形，有的是限量小批量生产。两种都为了每天戴，而不是为了收藏。",
      },
      { type: "h", text: "手作就意味着不一样" },
      {
        type: "p",
        text: "手作成形的款式不可能完全相同：弧度、锤纹、表面光泽的细微差别属于作品本身，不是瑕疵。孤品拍的就是你收到的那一件。",
      },
      { type: "h", text: "材质" },
      {
        type: "p",
        text: "每件商品页都写明真实材质——金属种类、纯度、是否电镀。天然石与珍珠的颜色、形状本来就每一颗都不同。",
      },
      { type: "h", text: "从哪里发货" },
      {
        type: "p",
        text: "所有订单从中国义乌发出。跨境包裹走国际物流渠道，中国境内用国内快递。页面显示的价格已含税。",
      },
      {
        type: "note",
        text: "待补（Q-44）：工作室所在地、创立契机、主理人故事由站长提供。品牌名与 Slogan 已于 2026-10-29 定稿。",
      },
    ],
  },
  faq: [
    {
      id: "shipping-time",
      question: "下单后多久发货？",
      answer:
        "备货需要 1–2 个工作日，之后在途 5–14 天。跨境包裹从中国义乌发出，交给物流商后会把运单号发给你。",
    },
    {
      id: "shipping-countries",
      question: "可以寄到哪些国家？",
      answer: "目前只发美国和中国大陆，后续再开放其他地区。",
    },
    {
      id: "shipping-cost",
      question: "运费怎么算？",
      answer:
        "满额包邮。免邮门槛会在首批定价定稿后确定，并在上线前公布在本页；未达门槛的订单按目的地收取一档固定运费。",
    },
    {
      id: "customs",
      question: "会产生关税或进口税吗？",
      answer:
        "页面价格已含税。跨境订单按 DDP 发出——由我们申报并预缴，收货时不会再向你收取任何额外费用。中国大陆境内订单不重复计税、不需报关。",
    },
    {
      id: "returns",
      question: "可以退货吗？",
      answer:
        "自签收起 14 天内可以退。我们收到并检查后 3–5 个工作日退款。出于卫生考虑，耳饰非质量问题不接受退货。孤品仅在质量问题时可退，退回后会按原样重新上架。",
    },
    {
      id: "restock",
      question: "孤品会重做吗？",
      answer: "不会。孤品只存在一件，售出后标记为「已售出」，商品页保留作为记录，但不再复刻。",
    },
    {
      id: "handmade-variation",
      question: "收到的和图片一样吗？",
      answer:
        "手作款接近但不完全相同：弧度、锤纹、表面处理每件都有细微差别。天然石与珍珠的颜色、形状也会因原石而异。",
    },
    {
      id: "nickel",
      question: "首饰含镍吗？",
      answer:
        "看具体款式：每件商品页都写明金属、纯度与是否电镀，可能含镍的款式会在过敏提示里标出。我们不会使用「低敏」「永不褪色」这类没有依据的说法。",
      pending: "Q-09 逐款含镍清单——待站长逐款确认",
    },
    {
      id: "care",
      question: "怎么保养？",
      answer:
        "避开水和香水，也不要用清洁剂；不戴时放进随附的绒袋。银会氧化、黄铜会自然生成包浆，都属正常，可以擦亮。",
    },
    {
      id: "order-change",
      question: "下单后能改或取消吗？",
      answer:
        "请尽快联系我们：发货前可以修改或取消。包裹已交给物流商后，请改走退货流程。",
      pending: "Q-47 客服邮箱域名",
    },
  ],
  policies: [
    {
      slug: "privacy",
      title: "隐私政策",
      status: "pending_review",
      updatedAt: "2026-10-27",
      blocks: [
        {
          type: "note",
          text: "未审核初稿：隐私政策须与 Cookie 同意条背后的真实数据流一致，并由熟悉目标市场法规的人审核后方可发布。",
        },
        { type: "h", text: "我们收集什么" },
        { type: "p", text: "待填写：订单信息、联系方式、支付信息（由支付服务商处理，本站不存储卡号）。" },
        { type: "h", text: "怎么使用" },
        { type: "p", text: "待填写：履约订单、客服沟通、法定义务；营销用途需单独同意。" },
        { type: "h", text: "与谁共享" },
        { type: "p", text: "待填写：支付服务商、物流服务商、邮件服务商（Q-34 / Q-35 / Q-36 确定后列举）。" },
        { type: "h", text: "保留多久" },
        { type: "p", text: "待填写：保留期限与删除条件。" },
        { type: "h", text: "你的权利" },
        { type: "p", text: "待填写：访问、更正、删除、撤回同意的渠道与响应时限。" },
        { type: "h", text: "联系我们" },
        { type: "p", text: "待补（Q-47）：客服邮箱由站长提供。" },
      ],
    },
    {
      slug: "cookies",
      title: "Cookie 政策",
      status: "pending_review",
      updatedAt: "2026-10-27",
      blocks: [
        {
          type: "note",
          text: "未审核初稿：Cookie 分类须与实际启用的技术一一对应；个性化追踪需单独同意并可撤回。",
        },
        { type: "h", text: "必要 Cookie" },
        { type: "p", text: "维持购物袋、结账与站点安全所必需，无需同意。" },
        { type: "h", text: "统计" },
        { type: "p", text: "待填写：V0.1 不接第三方统计（见技术边界）；启用后须在此列明并征得同意。" },
        { type: "h", text: "营销" },
        { type: "p", text: "待填写：个性化推荐与广告，仅在单独同意后启用（m-1d）。" },
      ],
    },
    {
      slug: "returns",
      title: "退换说明",
      status: "pending_review",
      updatedAt: "2026-10-30",
      blocks: [
        { type: "h", text: "退货窗口" },
        { type: "p", text: "自包裹签收日起 14 天内。" },
        { type: "h", text: "商品状态" },
        { type: "p", text: "需未佩戴、原包装退回。每件退货我们都会检查后再退款。" },
        { type: "h", text: "耳饰" },
        { type: "p", text: "出于卫生考虑，耳饰非质量问题不接受退货。" },
        { type: "h", text: "孤品" },
        { type: "p", text: "孤品仅在质量问题时可退。退回的孤品会按原样重新上架，不会重做。" },
        { type: "h", text: "退款" },
        { type: "p", text: "收到并检查退货后 3–5 个工作日退款，退回原支付方式。" },
        { type: "h", text: "如何申请" },
        { type: "p", text: "请带上订单号与商品照片联系我们。客服邮箱待站长确认（Q-47）。" },
      ],
    },
    {
      slug: "shipping",
      title: "配送说明",
      status: "pending_review",
      updatedAt: "2026-10-30",
      blocks: [
        { type: "h", text: "从哪里发出" },
        { type: "p", text: "所有订单从中国义乌发出。" },
        { type: "h", text: "寄往哪里" },
        { type: "p", text: "美国与中国大陆。其他地区后续开放。" },
        { type: "h", text: "时效" },
        { type: "p", text: "分两段：备货 1–2 个工作日，之后在途 5–14 天。跨境包裹走国际物流渠道，中国境内用国内快递。" },
        { type: "h", text: "运费" },
        { type: "p", text: "满额包邮，门槛在首批定价定稿后、上线前公布于本页。未达门槛按目的地收取一档固定运费——我们不接实时报价，结账看到的价格就是最终价格。" },
        { type: "h", text: "税费与关税" },
        { type: "p", text: "价格已含税。跨境订单按 DDP 发出：由我们申报并预缴关税，收货时不再额外收费。中国大陆境内订单不重复计税、不需报关。" },
      ],
    },
    {
      slug: "terms",
      title: "条款与条件",
      status: "pending_review",
      updatedAt: "2026-10-30",
      blocks: [
        {
          type: "note",
          text: "未审核初稿：适用法律、责任限制、争议处理等商业条款由站长于 2026-11-06 前提供，并经法务审核后方可发布。",
        },
        { type: "h", text: "使用本站" },
        { type: "p", text: "浏览或下单即表示同意本条款。商品图片、文案与品牌标识归 Morrow & Muse 所有，不得商用转载。" },
        { type: "h", text: "订单与价格" },
        { type: "p", text: "下单是购买要约；我们接受订单并确认发货时合同成立。价格同时以美元与人民币展示、已含税，换算仅用于展示——实际结算币种在结账时确认。" },
        { type: "h", text: "库存" },
        { type: "p", text: "孤品只有一件。若在下单与发货之间售出，该行订单取消并全额退款。" },
        { type: "h", text: "退换与退款" },
        { type: "p", text: "按《退换说明》执行：14 天内、未佩戴；耳饰因卫生原因除外；孤品仅质量问题可退。" },
        { type: "h", text: "待补" },
        { type: "p", text: "待补：适用法律、责任限制、投诉渠道与经营主体（Q-24 / Q-34）。" },
      ],
    },
  ],
};

export const CONTENT: Record<Locale, SiteContent> = { en, zh };

export function getContent(locale: Locale): SiteContent {
  return CONTENT[locale];
}
