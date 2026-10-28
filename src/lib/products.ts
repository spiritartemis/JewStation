import sample from "@/data/products.sample.json";
import type { Product } from "./types";

/**
 * 商品数据访问层（唯一出入口）
 *
 * 现阶段读样例数据（src/data/products.sample.json）。切换到 Postgres 时只需改本文件，
 * 页面与组件不感知数据源变更（见 docs/spec/08-技术与服务边界决策.md）。
 *
 * ⚠️ 样例数据不是真实商品：真实首批资料由站长提供（0.2-10 / 0.1-11）后替换。
 */

const ALL = (sample.products as unknown as Product[]).filter((p) => p.status === "active");

function byNewest(a: Product, b: Product): number {
  return b.createdAt.localeCompare(a.createdAt);
}

export function getAllProducts(): Product[] {
  return [...ALL].sort(byNewest);
}

export function getNewArrivals(limit?: number): Product[] {
  const list = getAllProducts();
  return typeof limit === "number" ? list.slice(0, limit) : list;
}

/** 手工孤品区（B-2.2）：只取 one_of_a_kind */
export function getOneOfAKind(limit?: number): Product[] {
  const list = getAllProducts().filter((p) => p.productType === "one_of_a_kind");
  return typeof limit === "number" ? list.slice(0, limit) : list;
}

/** 流行款区（B-2.2）：可补货款 */
export function getTrending(limit?: number): Product[] {
  const list = getAllProducts().filter((p) => p.productType === "restockable");
  return typeof limit === "number" ? list.slice(0, limit) : list;
}

export function getProductBySlug(slug: string): Product | undefined {
  return ALL.find((p) => p.slug === slug);
}

/**
 * 集合页：slug 与标签 slug 同源（03 §6.6）
 * 支持 品类 / 风格 / 材质 / 商品类型 / new（新品）
 */
export function getProductsByCollection(slug: string): Product[] {
  if (slug === "new") return getNewArrivals();
  if (slug === "one-of-a-kind" || slug === "one_of_a_kind") return getOneOfAKind();
  if (slug === "restockable") return getTrending();

  return getAllProducts().filter(
    (p) =>
      p.category === slug ||
      p.tags.style.includes(slug) ||
      p.tags.material.includes(slug),
  );
}

/** 搜索（B-2.5）：命中英文标题与标签 */
export function searchProducts(query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return getAllProducts().filter((p) => {
    const haystack = [
      p.title,
      p.shortCopy,
      p.category,
      ...p.tags.style,
      ...p.tags.material,
      ...p.materials,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export type ProductFilters = {
  categories?: string[];
  styles?: string[];
  materials?: string[];
  types?: string[];
  priceMin?: number;
  priceMax?: number;
  sort?: "newest" | "price-asc" | "price-desc";
};

/** 列表筛选（B-2.3）：各维度可叠加 */
export function getFilteredProducts(filters: ProductFilters, source?: Product[]): Product[] {
  const base = source ?? getAllProducts();

  const list = base.filter((p) => {
    if (filters.categories?.length && !filters.categories.includes(p.category)) return false;
    if (filters.styles?.length && !p.tags.style.some((s) => filters.styles!.includes(s))) return false;
    if (filters.materials?.length && !p.tags.material.some((m) => filters.materials!.includes(m)))
      return false;
    if (filters.types?.length && !filters.types.includes(p.productType)) return false;
    if (typeof filters.priceMin === "number" && p.price < filters.priceMin) return false;
    if (typeof filters.priceMax === "number" && p.price > filters.priceMax) return false;
    return true;
  });

  switch (filters.sort) {
    case "price-asc":
      return list.sort((a, b) => a.price - b.price);
    case "price-desc":
      return list.sort((a, b) => b.price - a.price);
    default:
      return list.sort(byNewest);
  }
}

export function getProductCategories(): string[] {
  return Array.from(new Set(ALL.map((p) => p.category)));
}
