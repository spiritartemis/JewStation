"use client";

import {
  formatDimension,
  formatWeight,
  localizeMaterials,
  optionValueLabel,
  optionValueNote,
  selectedSizeText,
  specGroupsOf,
  type Product,
} from "@/lib/types";
import type { Locale } from "@/i18n/config";
import { useProductSpec } from "./ProductSpecContext";

/**
 * 商品事实区块（材质 / 尺寸 / 重量 / 开合 / 可选尺码 / 保养）
 *
 * 做成客户端组件只为两件事（2026-10-30）：
 * 1. 「尺寸」跟随所选尺码变化 —— 服务端渲染时选中态在另一个组件里，拿不到；
 * 2. 「开合方式」跟随所选做法变化 —— 手链开口/死圈是同一款的不同做法，
 *    只有一种做法时直接写做法，有两种时按选择写对应的说明。
 *
 * 其余行（材质/重量/保养）与服务端渲染结果一致，不受影响。
 */
export function ProductFactList({
  product,
  locale,
  labels,
}: {
  product: Product;
  locale: Locale;
  labels: {
    material: string;
    size: string;
    weight: string;
    closure: string;
    sizes: string;
    care: string;
    notSpecified: string;
  };
}) {
  const ctx = useProductSpec();
  const groups = specGroupsOf(product, locale);
  const selected = ctx?.selected ?? {};

  // 材质：走系统词典，中文页不再直接吐 "Sterling silver 925"
  const materialText = localizeMaterials(product.materials, locale).join("、");

  // 尺寸：有尺码规格时以所选尺码为准，否则显示实测尺寸（值里已自带单位，不再重复拼）
  const sizeSelected = selectedSizeText(product, groups, selected, locale);
  const sizeText = sizeSelected ?? formatDimension(product.dimensions, locale) ?? "";

  // 开合：优先按所选做法写（含说明），没有规格组时回退数据里的 closureType
  const closureGroup = groups.find((g) => g.name.toLowerCase() === "closure");
  let closureText = product.closureType ?? "";
  if (closureGroup) {
    const index = selected[closureGroup.name] ?? 0;
    const value = closureGroup.values[index] ?? closureGroup.values[0];
    if (value) {
      // 不再重复组名：行标签（开合方式 / Closure）已经说了一次，值里再写一遍是噪音
      const note = optionValueNote(value, locale);
      const label = optionValueLabel(value, locale);
      closureText = note ? `${label} — ${note}` : label;
    }
  }

  const sizeGroup = groups.find((g) => g.name.toLowerCase() === "size");

  return (
    <div className="mt-sp5 divide-y divide-line border-y border-line">
      <FactRow label={labels.material} value={materialText || labels.notSpecified} />
      <FactRow label={labels.size} value={sizeText || labels.notSpecified} />
      <FactRow label={labels.weight} value={formatWeight(product.weight, locale)} />
      {closureText ? <FactRow label={labels.closure} value={closureText} /> : null}
      {sizeGroup?.values.length ? (
        <FactRow
          label={labels.sizes}
          value={sizeGroup.values.map((v) => optionValueLabel(v, locale)).join(" / ")}
        />
      ) : null}
      <FactRow label={labels.care} value={product.careInstructions} />
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <details className="group">
      <summary className="flex min-h-[44px] cursor-pointer items-center justify-between text-body text-ink">
        {label}
        <span className="text-muted">+</span>
      </summary>
      <p className="pb-sp3 text-body text-muted">{value}</p>
    </details>
  );
}
