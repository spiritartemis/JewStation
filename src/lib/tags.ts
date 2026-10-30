import dict from "@/data/tags.json";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

/**
 * 标签字典（单一真源 = src/data/tags.json）
 * 依据：docs/spec/03-标签字典与分类规则.md
 * 规则：集合页 slug = 标签 slug，禁止另起一套命名（03 §6.6）
 *
 * 字典放在 JSON 是为了让录入校验脚本（scripts/validate-products.mjs）与前端共用同一份数据，
 * 避免两处字典漂移。
 *
 * 双语（Q-02）：`label` 是英文底稿，`labelZh` 是中文稿；中文缺失时回退英文，
 * 保证新增标签忘翻译时页面不会出现空白。
 */

export type Tag = { slug: string; label: string; labelZh?: string };

export const CATEGORY_TAGS = dict.categories as Tag[];
export const STYLE_TAGS = dict.styles as Tag[];
export const MATERIAL_TAGS = dict.materials as Tag[];
export const PRODUCT_TYPES = dict.productTypes as Tag[];

export const PRODUCT_TYPE_ONE_OF_A_KIND = "one_of_a_kind";
export const PRODUCT_TYPE_RESTOCKABLE = "restockable";

const TAG_MAP = new Map<string, Tag>(
  [...CATEGORY_TAGS, ...STYLE_TAGS, ...MATERIAL_TAGS, ...PRODUCT_TYPES].map((t) => [t.slug, t]),
);

/** 标签 slug → 展示名；未登记的值原样返回（便于发现脏数据） */
export function tagLabel(slug: string, locale: Locale = DEFAULT_LOCALE): string {
  const tag = TAG_MAP.get(slug);
  if (!tag) return slug;
  if (locale === "zh") return tag.labelZh ?? tag.label;
  return tag.label;
}

/** 批量取展示名（筛选、面包屑、结构化数据共用） */
export function tagLabels(slugs: string[], locale: Locale = DEFAULT_LOCALE): string[] {
  return slugs.map((s) => tagLabel(s, locale));
}

/** 集合页 slug 是否属于已登记标签（未登记则不生成集合页） */
export function isKnownCollection(slug: string): boolean {
  return TAG_MAP.has(slug);
}
