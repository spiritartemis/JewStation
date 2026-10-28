"use client";

import { useRouter } from "next/navigation";
import {
  PRICE_BUCKETS,
  buildQueryString,
  countActiveFilters,
  splitList,
  type ListParams,
} from "@/lib/filters";
import { tagLabel } from "@/lib/tags";

const KEYS = ["category", "style", "material", "type", "price"] as const;

function labelOf(key: (typeof KEYS)[number], value: string): string {
  if (key === "price") return PRICE_BUCKETS.find((b) => b.id === value)?.label ?? value;
  // 品类/风格/材质/类型都在同一份标签字典里，tagLabel 能覆盖
  return tagLabel(value);
}

/**
 * 已选筛选条（B-2.3 的可用性配套）
 *
 * 抽屉关掉之后用户看不到"自己选了什么"，只能靠重开筛选才能改。
 * 这里把每个筛选值显性化，可单独移除，也可一键清空，且都写回 URL。
 */
export function ActiveFilters({ params, basePath }: { params: ListParams; basePath: string }) {
  const router = useRouter();
  const count = countActiveFilters(params);
  if (count === 0) return null;

  const go = (next: ListParams) =>
    router.replace(`${basePath}${buildQueryString(next)}`, { scroll: false });

  const remove = (key: (typeof KEYS)[number], value: string) => {
    const rest = splitList(params[key]).filter((v) => v !== value);
    go({ ...params, [key]: rest.length ? rest.join(",") : undefined });
  };

  const clearAll = () => go({ sort: params.sort });

  return (
    <div className="shell mt-sp3 flex flex-wrap items-center gap-sp2">
      {KEYS.flatMap((key) =>
        splitList(params[key]).map((value) => (
          <button
            key={`${key}-${value}`}
            type="button"
            onClick={() => remove(key, value)}
            className="inline-flex h-9 items-center gap-sp2 rounded-btn border border-line bg-surface px-sp3 text-aux text-ink"
            aria-label={`Remove filter ${labelOf(key, value)}`}
          >
            {labelOf(key, value)}
            <span aria-hidden="true" className="text-muted">
              ×
            </span>
          </button>
        )),
      )}

      <button
        type="button"
        onClick={clearAll}
        className="h-9 px-sp2 text-aux text-muted underline hover:text-accent"
      >
        Clear all ({count})
      </button>
    </div>
  );
}
