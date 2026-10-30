/**
 * 商品类型定义
 * 来源：docs/spec/02-商品数据模型.md（B-1.2 定稿表）
 * 规则：孤品与可补货款共用一套模型，差异只由 productType + stock 表达（B-1.4）
 */

import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

export type ProductType = "one_of_a_kind" | "restockable";
export type Availability = "in_stock" | "sold_out";
export type ProductStatus = "draft" | "active" | "archived";

export type ProductImage = {
  url: string;
  alt: string;
  width: number;
  height: number;
  order: number;
  isPrimary: boolean;
};

export type Dimension = {
  length?: string;
  width?: string;
  diameter?: string;
  unit: "mm";
};

export type Weight = {
  value: number;
  unit: "g";
};

export type ProductTags = {
  style: string[];
  material: string[];
  occasion?: string[];
  collection?: string[];
};

/**
 * 可选规格（Q-06）
 *
 * 手链的「开口 / 死圈」是**同一款的两种规格**，不是两个商品 —— 所以它属于
 * option，不属于 variant（variant 会各自带库存与 SKU，把一个款拆成两条商品）。
 * 戒指的码数、项链的链长同理。
 */
export type ProductOptionValue = {
  /** 英文底稿，如 Open cuff */
  label: string;
  /** 中文稿（Q-02），缺省回退英文 */
  labelZh?: string;
  /** 该规格的说明（英文）：如开口款可微调、死圈需按手围选。选中后在「开合方式」行显示 */
  note?: string;
  noteZh?: string;
};

export type ProductOption = {
  /** 规格名（英文底稿），如 Closure / Size */
  name: string;
  nameZh?: string;
  values: ProductOptionValue[];
};

/**
 * 中文覆盖（Q-02）
 *
 * 商品文案以英文为底稿；中文由初翻 + 校对后填在这个对象里，
 * 缺字段自动回退英文，不会出现半截空白。
 */
export type ProductI18n = {
  title?: string;
  shortCopy?: string;
  description?: string;
  highlights?: string[];
  allergyNotice?: string;
  careInstructions?: string;
  handmadeVariation?: string;
  oneOfAKindNote?: string;
  closureType?: string;
};

export type Product = {
  id: string;
  sku: string;
  slug: string;
  createdAt: string;
  updatedAt: string;

  title: string;
  shortCopy: string;
  description: string;
  highlights?: string[];
  seoTitle?: string;
  seoDescription?: string;

  price: number;
  currency: string;
  compareAtPrice?: number;
  productType: ProductType;
  stock: number;
  status: ProductStatus;

  materials: string[];
  metalPurity?: string;
  plating?: string;
  dimensions: Dimension;
  weight: Weight;
  closureType?: string;
  /** 固定尺寸（如戒指码数）——与 options 二选一，不再混用 */
  sizeOptions?: string[];
  /** 可选规格（Q-06）：Closure / Size / Length 等 */
  options?: ProductOption[];

  allergyNotice: string;
  careInstructions: string;
  handmadeVariation?: string;
  oneOfAKindNote?: string;

  images: ProductImage[];

  category: string;
  tags: ProductTags;

  /** 中文覆盖（Q-02） */
  i18n?: { zh?: ProductI18n };
};

/** availability 由 stock 派生，不手填（02 §4.2） */
export function availabilityOf(p: Product): Availability {
  return p.stock > 0 ? "in_stock" : "sold_out";
}

export function isSoldOut(p: Product): boolean {
  return availabilityOf(p) === "sold_out";
}

/** 孤品售罄展示 Sold；可补货售罄展示 Out of stock（05 §4） */
export function soldLabel(p: Product, locale: Locale = DEFAULT_LOCALE): string {
  if (p.productType === "one_of_a_kind") return locale === "zh" ? "已售出" : "Sold";
  return locale === "zh" ? "暂时缺货" : "Out of stock";
}

/** 可补货款库存 ≤3 时提示「Only N left」（05 §4） */
export function lowStockLabel(p: Product, locale: Locale = DEFAULT_LOCALE): string | null {
  if (p.productType !== "restockable") return null;
  if (p.stock <= 0 || p.stock > 3) return null;
  return locale === "zh" ? `仅剩 ${p.stock} 件` : `Only ${p.stock} left`;
}

/**
 * 商品文案本地化：中文站取 i18n.zh 覆盖，缺字段回退英文底稿。
 * 只在渲染层做，不改数据源 —— 数据源里的英文始终是底稿。
 */
export function localizeProduct(p: Product, locale: Locale = DEFAULT_LOCALE): Product {
  if (locale === DEFAULT_LOCALE) return p;
  const zh = p.i18n?.zh;
  if (!zh) return p;

  return {
    ...p,
    title: zh.title ?? p.title,
    shortCopy: zh.shortCopy ?? p.shortCopy,
    description: zh.description ?? p.description,
    highlights: zh.highlights ?? p.highlights,
    allergyNotice: zh.allergyNotice ?? p.allergyNotice,
    careInstructions: zh.careInstructions ?? p.careInstructions,
    handmadeVariation: zh.handmadeVariation ?? p.handmadeVariation,
    oneOfAKindNote: zh.oneOfAKindNote ?? p.oneOfAKindNote,
    closureType: zh.closureType ?? p.closureType,
  };
}

/**
 * 材质名中译（2026-10-30）
 *
 * 材质是**结构化事实**，不是品牌文案，所以走系统词典而不是商品的 i18n.zh 覆盖：
 * 同一材质在十个商品里必须同一个译法，写进商品各自的 i18n 必然会出现
 * 「925 银 / 925 纯银 / 纯银」三种说法。词典未命中时原样返回英文，
 * 保证新增材质不会在中文页变成空白。
 */
const MATERIAL_LABELS_ZH: Record<string, string> = {
  "sterling silver 925": "925 纯银",
  "sterling silver": "纯银",
  "925 silver": "925 纯银",
  "freshwater pearl": "淡水珍珠",
  pearl: "珍珠",
  brass: "黄铜",
  "gold vermeil": "厚金包银",
  "gold plated": "镀金",
  "14k gold": "14K 金",
  "natural stone": "天然石材",
  stone: "石材",
  ceramic: "陶瓷",
  "textile / cord": "织绳",
  "textile/cord": "织绳",
  cord: "织绳",
  textile: "织物",
  resin: "树脂",
  enamel: "珐琅",
  "stainless steel": "不锈钢",
  copper: "铜",
};

/** 材质列表按语言渲染 */
export function localizeMaterials(materials: string[], locale: Locale = DEFAULT_LOCALE): string[] {
  if (locale === DEFAULT_LOCALE) return materials;
  return materials.map((raw) => MATERIAL_LABELS_ZH[raw.trim().toLowerCase()] ?? raw);
}

/** 计量单位中译（尺寸值里自带 mm / g，中文页统一换成汉字） */
const UNIT_LABELS_ZH: Record<string, string> = { mm: "毫米", cm: "厘米", g: "克", kg: "千克" };

export function localizeUnit(unit: string, locale: Locale = DEFAULT_LOCALE): string {
  return locale === "zh" ? (UNIT_LABELS_ZH[unit.toLowerCase()] ?? unit) : unit;
}

/**
 * 尺寸文案（2026-10-30 修正）
 *
 * 数据里 length/width 自带单位（"32mm"），页面原先再拼一次 unit，
 * 结果渲染成「32mm × 4mm mm」—— 尾部多出两个 m。这里先把值里的单位剥掉，
 * 再统一补一次本地化单位，中英文各只出现一次。
 */
export function formatDimension(d: Dimension, locale: Locale = DEFAULT_LOCALE): string {
  const parts = [d.length, d.width, d.diameter]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.replace(/\s*(mm|cm)\s*$/i, "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return `${parts.join(" × ")} ${localizeUnit(d.unit, locale)}`;
}

/** 重量文案：数值 + 本地化单位 */
export function formatWeight(w: Weight, locale: Locale = DEFAULT_LOCALE): string {
  return `${w.value} ${localizeUnit(w.unit, locale)}`;
}

/** 规格名/值取语言版本 */
export function optionName(opt: ProductOption, locale: Locale = DEFAULT_LOCALE): string {
  return locale === "zh" ? (opt.nameZh ?? opt.name) : opt.name;
}

export function optionValueLabel(
  value: ProductOptionValue,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return locale === "zh" ? (value.labelZh ?? value.label) : value.label;
}

/** 规格值的说明文案（选中后在事实行展示），缺则为空 */
export function optionValueNote(
  value: ProductOptionValue,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return locale === "zh" ? (value.noteZh ?? value.note ?? "") : (value.note ?? "");
}

/**
 * 商品的可选规格组（2026-10-30）
 *
 * 数据里有两种来源：显式的 `options`（手链开口/死圈这类带说明的做法）与
 * 隐式的 `sizeOptions`（戒指的固定码数清单）。戒指原先只有码数清单、没有选择器，
 * 用户没法「先选尺码再看尺寸」，所以这里把 sizeOptions 提升成 Size 规格组，
 * 与显式 options 合并成一份，供选择器与事实行共用。
 */
export function specGroupsOf(p: Product, locale: Locale = DEFAULT_LOCALE): ProductOption[] {
  const groups: ProductOption[] = [...(p.options ?? [])];
  const hasSizeGroup = groups.some((g) => g.name.toLowerCase() === "size");
  if (!hasSizeGroup && p.sizeOptions?.length) {
    groups.push({
      name: "Size",
      nameZh: "尺寸",
      values: p.sizeOptions.map((s) => ({ label: s, labelZh: s })),
    });
  }
  return groups;
}

/**
 * 尺寸组选中值对应的内径文案
 *
 * 戒指码数在数据里就是内径毫米数（16/17/18），选中哪一项，事实行的尺寸就跟着变
 * —— 原先尺寸行只显示固定的 dimensions，选了 18 码上面仍写 17mm。
 */
export function selectedSizeText(
  p: Product,
  groups: ProductOption[],
  selected: Record<string, number>,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  const sizeGroup = groups.find((g) => g.name.toLowerCase() === "size");
  if (!sizeGroup) return null;
  const index = selected[sizeGroup.name] ?? 0;
  const value = sizeGroup.values[index];
  if (!value) return null;
  const label = optionValueLabel(value, locale);
  const mm = label.replace(/[^\d.]/g, "");
  return mm
    ? locale === "zh"
      ? `${label} 码 · 内径 ${mm} 毫米`
      : `Size ${label} · ${mm} mm inner diameter`
    : label;
}

/** 结构化数据用：始终输出基准币种（USD）的金额字符串 */
export function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}
