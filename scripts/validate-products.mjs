#!/usr/bin/env node
/**
 * 商品录入校验（可重复执行）
 *
 * 用法：
 *   node scripts/validate-products.mjs                 # 校验 src/data/products.sample.json
 *   node scripts/validate-products.mjs <products.json> # 校验指定文件
 *   node scripts/validate-products.mjs --sample        # 样例模式：缺实拍图只警告不报错
 *
 * 判据来源：
 *   docs/spec/02-商品数据模型.md §4（校验规则 1–7）· §5（完整率 8 项）
 *   docs/spec/04-孤品与可补货状态流转.md（孤品库存恒 1）
 *   docs/spec/03-标签字典与分类规则.md（标签必须存在于字典）
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = process.argv.slice(2);
const sampleMode = args.includes("--sample");
const fileArg = args.find((a) => !a.startsWith("--"));
const productsPath = resolve(root, fileArg ?? "src/data/products.sample.json");

const dict = JSON.parse(readFileSync(resolve(root, "src/data/tags.json"), "utf8"));
const raw = JSON.parse(readFileSync(productsPath, "utf8"));
const products = Array.isArray(raw) ? raw : raw.products ?? [];

const slugsOf = (list) => new Set(list.map((t) => t.slug));
const CATEGORIES = slugsOf(dict.categories);
const STYLES = slugsOf(dict.styles);
const MATERIALS = slugsOf(dict.materials);
const TYPES = slugsOf(dict.productTypes);

const errors = [];
const warnings = [];
const seenSlugs = new Set();
const currencies = new Set();

function fail(sku, msg) {
  errors.push(`${sku}: ${msg}`);
}
function warn(sku, msg) {
  warnings.push(`${sku}: ${msg}`);
}

for (const p of products) {
  const sku = p.sku ?? "(no sku)";

  // slug 唯一性与命名
  if (!p.slug) fail(sku, "slug 缺失");
  else {
    if (seenSlugs.has(p.slug)) fail(sku, `slug 重复：${p.slug}`);
    seenSlugs.add(p.slug);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) fail(sku, `slug 不符合小写连字符规则：${p.slug}`);
  }

  // 完整率 8 项（02 §5）
  if (typeof p.price !== "number") fail(sku, "price 缺失或非数字");
  if (typeof p.stock !== "number") fail(sku, "stock 缺失或非数字");
  if (!TYPES.has(p.productType)) fail(sku, `productType 非法：${p.productType}`);
  if (!Array.isArray(p.materials) || p.materials.length === 0) fail(sku, "materials 缺失");
  if (!p.dimensions) fail(sku, "dimensions 缺失");
  if (!p.weight) fail(sku, "weight 缺失");
  if (!p.tags || !p.category) fail(sku, "tags / category 缺失");

  // 单位固定（02 §4.5）
  if (p.dimensions && p.dimensions.unit !== "mm") fail(sku, "dimensions.unit 必须为 mm");
  if (p.weight && p.weight.unit !== "g") fail(sku, "weight.unit 必须为 g");

  // 单币种（02 §4.6）
  if (p.currency) currencies.add(p.currency);

  // 孤品库存（02 §3 / 04）：入库须为 1，售出后为 0，任何 >1 都是错的
  if (p.productType === "one_of_a_kind") {
    if (p.stock > 1) fail(sku, `孤品 stock 必须 ≤ 1，当前 ${p.stock}`);
    if (p.stock === 1 && !p.oneOfAKindNote) fail(sku, "孤品缺 oneOfAKindNote");
    if (!p.handmadeVariation) fail(sku, "孤品缺 handmadeVariation");
  }

  // 图片（02 §4.4）：至少 3 张且每张有 alt
  const images = Array.isArray(p.images) ? p.images : [];
  if (images.length < 3) {
    const msg = `图片不足 3 张（当前 ${images.length}）`;
    sampleMode ? warn(sku, msg) : fail(sku, msg);
  }
  for (const img of images) {
    if (!img.alt) fail(sku, "存在无 alt 的图片");
    if (typeof img.width !== "number" || typeof img.height !== "number")
      fail(sku, "图片缺 width/height（会引发 CLS）");
  }
  if (images.length && !images.some((i) => i.isPrimary)) warn(sku, "未标记主图 isPrimary");

  // 标签外键（03 §6.1）
  if (p.category && !CATEGORIES.has(p.category)) fail(sku, `category 不在字典：${p.category}`);
  for (const s of p.tags?.style ?? []) if (!STYLES.has(s)) fail(sku, `style 不在字典：${s}`);
  for (const m of p.tags?.material ?? []) if (!MATERIALS.has(m)) fail(sku, `material 不在字典：${m}`);
  if ((p.tags?.style ?? []).length === 0) fail(sku, "style 标签至少 1 个");
  if ((p.tags?.material ?? []).length === 0) fail(sku, "material 标签至少 1 个");
  if ((p.tags?.style ?? []).length > 3) warn(sku, "style 标签超过 3 个（03 §3 数量纪律）");

  // 长度（02 §4.3）
  if (p.title && p.title.length > 60) fail(sku, `title 超 60 字符（${p.title.length}）`);
  if (p.seoTitle && p.seoTitle.length > 60) fail(sku, `seoTitle 超 60 字符`);
  if (p.seoDescription && p.seoDescription.length > 155)
    fail(sku, `seoDescription 超 155 字符`);

  // availability 派生一致性（02 §4.2）
  if (p.availability && p.availability !== (p.stock > 0 ? "in_stock" : "sold_out"))
    fail(sku, `availability 与 stock 不一致：${p.availability}`);
}

if (currencies.size > 1)
  errors.push(`全站币种不统一：${[...currencies].join(", ")}（V0.1 单币种）`);

const line = (s) => console.log(s);
line(`\n校验文件：${productsPath}`);
line(`商品数：${products.length}`);
if (warnings.length) {
  line(`\n警告 ${warnings.length} 条：`);
  warnings.forEach((w) => line(`  · ${w}`));
}
if (errors.length) {
  line(`\n错误 ${errors.length} 条：`);
  errors.forEach((e) => line(`  ✗ ${e}`));
  line("\n结论：不通过（缺项必须逐条补齐，不得留空蒙混 —— B-1.10）\n");
  process.exit(1);
}
line("\n结论：通过\n");
