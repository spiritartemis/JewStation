import type { Doc } from "./types";

/**
 * 站点文案内容源
 * 来源：docs/spec/07-站点文案与合规文本.md
 *
 * ⚠️ 凡是 status = pending_review 的文档，均为**未审核初稿**，
 * 上线前必须由熟悉目标市场的人（业务/法律）复核，不得直接发布（B-1.8）。
 * 带【待确认】的句子必须由站长给出答案后回填。
 */

/**
 * 首页 Hero 文案（B-2.2 第一区块）
 * 文案放内容源而非组件（B-2.8）；图片素材属站长（Q-16 / Q-53），未到位前只渲染占位。
 */
export const HOME_HERO = {
  /** 眉标：品牌名（Morrow & Muse / 明日缪斯），全大写 + 大字距，交代身份但不抢主标语 */
  eyebrow: "Morrow & Muse",
  /** 主标语第一行（正体）：品牌 Slogan「Made for your becoming.」的上半句 */
  headline: "Made for your",
  /** 主标语第二行（斜体 + 陶色，构成编辑感的双行大字）：Slogan 的下半句 */
  headlineAccent: "becoming.",
  /** 副标：把 Slogan 落到具体动作（小批量、手作、孤品），中文语义「为你而生」 */
  subline: "Small-batch, handmade pieces for the person you're becoming.",
  ctaLabel: "Shop new",
  ctaHref: "/collections/new",
  /** 主图为空时的占位说明 */
  imagePendingNote: "Hero photo pending",
  /**
   * 图片就位后填 /public 下的路径；为空则渲染占位块。
   * ⚠️ 当前为 AI 生成的概念占位图（public/images/hero-home.jpg），
   * 上线前需替换为真实品牌视觉 / 实拍场景图。
   */
  imageUrl: "/images/hero-home-light.jpg",
  imageAlt:
    "Two polished silver huggie hoops, a fine silver chain with a small round pendant and a single baroque pearl stud, resting on a warm off-white plaster surface in soft window light.",
} as const;

/**
 * 首页区块说明文案（B-2.8：文案不进组件）
 * ⚠️ 初稿，上线前需由熟悉目标市场的人复核（B-1.8）。
 */
export const HOME_SECTIONS = {
  /** 手工孤品区：说明「只有一件、拍的就是你收到的那件」，是站点承诺而非促销话术 */
  oneOfAKind: {
    description: "Each piece is made once — photographed as the exact one you'll receive.",
  },
} as const;

export const ABOUT: Doc = {
  slug: "about",
  title: "About",
  status: "draft",
  updatedAt: "2026-10-29",
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
    {
      type: "note",
      text: "【待确认 Q-44】品牌故事细节（创立契机、工作室所在地、主理人）待站长补充；品牌名与 Slogan 已于 2026-10-29 定稿。",
    },
  ],
};

export type FaqItem = { id: string; question: string; answer: string; pending?: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: "shipping-time",
    question: "When will my order ship?",
    answer: "【待确认 Q-22】发货时效待站长确认后回填。",
  },
  {
    id: "shipping-countries",
    question: "Which countries do you ship to?",
    answer: "【待确认 Q-21】配送国家/地区待站长确认后回填。",
  },
  {
    id: "shipping-cost",
    question: "How much is shipping?",
    answer: "【待确认 Q-31】运费规则（免邮门槛 / 按重量 / 按地区）待站长确认后回填。",
  },
  {
    id: "customs",
    question: "Will I pay customs or import tax?",
    answer: "【待确认 Q-32】税费与关税口径（DDU / DDP）待站长确认后回填。",
  },
  {
    id: "returns",
    question: "Can I return an item?",
    answer: "【待确认 Q-13】退换货规则待站长确认；其中「孤品是否可退」需单独拍板。",
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
      "It depends on the piece: we state the actual metal on every product page, and flag pieces that may contain nickel in the allergy notice. 【待确认 Q-09】含镍材质的具体清单待站长确认。",
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
    answer: "【待确认 Q-24】下单后修改/取消规则与客服邮箱待站长确认后回填。",
  },
];

export const POLICIES: Doc[] = [
  {
    slug: "privacy",
    title: "Privacy policy",
    status: "pending_review",
    updatedAt: "2026-10-27",
    blocks: [
      {
        type: "note",
        text: "未审核初稿：隐私政策须与 Cookie 同意条的真实数据流一致，并由熟悉目标市场法规的人审核后方可发布。",
      },
      { type: "h", text: "What we collect" },
      { type: "p", text: "【待填写】订单信息、联系方式、支付信息（由支付服务商处理，本站不存储卡号）。" },
      { type: "h", text: "How we use it" },
      { type: "p", text: "【待填写】履约订单、客服沟通、法定义务；营销用途需单独同意。" },
      { type: "h", text: "Who we share it with" },
      { type: "p", text: "【待填写】支付服务商、物流服务商、邮件服务商（待 Q-34 / Q-35 / Q-36 确定后列举）。" },
      { type: "h", text: "How long we keep it" },
      { type: "p", text: "【待填写】保留期限与删除条件。" },
      { type: "h", text: "Your rights" },
      { type: "p", text: "【待填写】访问、更正、删除、撤回同意的渠道与响应时限。" },
      { type: "h", text: "Contact" },
      { type: "p", text: "【待确认 Q-33】客服邮箱待站长提供。" },
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
        text: "未审核初稿：Cookie 分类须与实际使用的技术一一对应；个性化追踪需单独同意并可撤回。",
      },
      { type: "h", text: "Strictly necessary" },
      { type: "p", text: "维持购物车、结账与安全所必需；无需同意。" },
      { type: "h", text: "Analytics" },
      { type: "p", text: "【待填写】V0.1 不接第三方分析（见 08 技术边界）；启用后须在此列明并征得同意。" },
      { type: "h", text: "Marketing" },
      { type: "p", text: "【待填写】个性化推荐与广告，仅在单独同意后启用（m-1d）。" },
    ],
  },
  {
    slug: "returns",
    title: "Returns & exchanges",
    status: "pending_review",
    updatedAt: "2026-10-27",
    blocks: [
      {
        type: "note",
        text: "未审核初稿：退货窗口与条件待站长拍板，其中「孤品是否可退」必须与 04 状态流转一致。",
      },
      { type: "h", text: "Return window" },
      { type: "p", text: "【待确认 Q-25】退货窗口天数待定。" },
      { type: "h", text: "Condition" },
      { type: "p", text: "【待确认 Q-26】是否要求未佩戴、原包装、吊牌完好。" },
      { type: "h", text: "One of a Kind" },
      { type: "p", text: "【待确认 Q-13】孤品是否接受退货 —— 直接决定退款是否回补库存（Q-12）。" },
      { type: "h", text: "How to start a return" },
      { type: "p", text: "【待确认 Q-33】退货流程与客服邮箱待定。" },
    ],
  },
  {
    slug: "shipping",
    title: "Shipping",
    status: "pending_review",
    updatedAt: "2026-10-27",
    blocks: [
      { type: "note", text: "未审核初稿：配送国家、时效与运费口径待站长确认后回填。" },
      { type: "h", text: "Where we ship" },
      { type: "p", text: "【待确认 Q-21】配送国家/地区清单待定。" },
      { type: "h", text: "Delivery times" },
      { type: "p", text: "【待确认 Q-22】各区域时效待定。" },
      { type: "h", text: "Rates" },
      { type: "p", text: "【待确认 Q-31】运费规则与免邮门槛待定。" },
      { type: "h", text: "Customs and import tax" },
      { type: "p", text: "【待确认 Q-32】DDU / DDP 口径待定。" },
    ],
  },
];
