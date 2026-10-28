/**
 * 商品类型定义
 * 来源：docs/spec/02-商品数据模型.md（B-1.2 定稿表）
 * 规则：孤品与可补货款共用一套模型，差异只由 productType + stock 表达（B-1.4）
 */

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
  sizeOptions?: string[];

  allergyNotice: string;
  careInstructions: string;
  handmadeVariation?: string;
  oneOfAKindNote?: string;

  images: ProductImage[];

  category: string;
  tags: ProductTags;
};

/** availability 由 stock 派生，不手填（02 §4.2） */
export function availabilityOf(p: Product): Availability {
  return p.stock > 0 ? "in_stock" : "sold_out";
}

export function isSoldOut(p: Product): boolean {
  return availabilityOf(p) === "sold_out";
}

/** 孤品售罄展示 Sold；可补货售罄展示 Out of stock（05 §4） */
export function soldLabel(p: Product): string {
  return p.productType === "one_of_a_kind" ? "Sold" : "Out of stock";
}

/** 可补货款库存 ≤3 时提示「Only N left」（05 §4） */
export function lowStockLabel(p: Product): string | null {
  if (p.productType !== "restockable") return null;
  if (p.stock <= 0 || p.stock > 3) return null;
  return `Only ${p.stock} left`;
}

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
