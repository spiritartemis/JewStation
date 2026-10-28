import type { ProductFilters } from "./products";

/**
 * 筛选条件与 URL 的互转（B-2.3：每个筛选值可直达 URL，可分享、可回退）
 * 多值用逗号分隔：`?category=earrings,rings&style=minimal&sort=price-asc`
 */

export type PriceBucket = { id: string; label: string; min?: number; max?: number };

export const PRICE_BUCKETS: PriceBucket[] = [
  { id: "under-50", label: "Under $50", max: 50 },
  { id: "50-100", label: "$50 – $100", min: 50, max: 100 },
  { id: "over-100", label: "Over $100", min: 100 },
];

export type SortKey = "newest" | "price-asc" | "price-desc";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "price-asc", label: "Price: low to high" },
  { key: "price-desc", label: "Price: high to low" },
];

export type ListParams = {
  category?: string;
  style?: string;
  material?: string;
  type?: string;
  price?: string;
  sort?: string;
};

/** "a,b" | ["a","b"] → ["a","b"] */
export function splitList(v?: string | string[]): string[] {
  if (!v) return [];
  const raw = Array.isArray(v) ? v.join(",") : v;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseListParams(sp: Record<string, string | string[] | undefined>): ListParams {
  return {
    category: sp.category as string | undefined,
    style: sp.style as string | undefined,
    material: sp.material as string | undefined,
    type: sp.type as string | undefined,
    price: sp.price as string | undefined,
    sort: sp.sort as string | undefined,
  };
}

/** URL 参数 → ProductFilters（价格桶转成 min/max） */
export function toProductFilters(p: ListParams): ProductFilters {
  const priceIds = splitList(p.price);
  const buckets = PRICE_BUCKETS.filter((b) => priceIds.includes(b.id));

  const mins = buckets.map((b) => b.min).filter((n): n is number => typeof n === "number");
  const maxs = buckets.map((b) => b.max).filter((n): n is number => typeof n === "number");

  const sort = (["newest", "price-asc", "price-desc"] as SortKey[]).includes(p.sort as SortKey)
    ? (p.sort as SortKey)
    : "newest";

  return {
    categories: splitList(p.category),
    styles: splitList(p.style),
    materials: splitList(p.material),
    types: splitList(p.type),
    priceMin: mins.length ? Math.min(...mins) : undefined,
    priceMax: maxs.length ? Math.max(...maxs) : undefined,
    sort,
  };
}

/** 修改一个维度的值（已选则移除），返回新的 URL 查询串 */
export function toggleValue(current: string[] | undefined, value: string): string[] {
  const list = current ?? [];
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function buildQueryString(p: ListParams): string {
  const usp = new URLSearchParams();
  for (const key of ["category", "style", "material", "type", "price"] as const) {
    const value = p[key];
    if (value) usp.set(key, value);
  }
  if (p.sort && p.sort !== "newest") usp.set("sort", p.sort);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export function countActiveFilters(p: ListParams): number {
  return (
    splitList(p.category).length +
    splitList(p.style).length +
    splitList(p.material).length +
    splitList(p.type).length +
    splitList(p.price).length
  );
}
