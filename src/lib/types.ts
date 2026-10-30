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
