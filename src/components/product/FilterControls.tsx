"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PRICE_BUCKETS,
  buildQueryString,
  countActiveFilters,
  splitList,
  toggleValue,
  type ListParams,
} from "@/lib/filters";
import { MATERIAL_TAGS, CATEGORY_TAGS, STYLE_TAGS, PRODUCT_TYPES, tagLabel } from "@/lib/tags";
import { CloseIcon } from "@/components/layout/icons";
import { getMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import { SortSelect } from "./SortSelect";

type GroupKey = "category" | "style" | "material" | "type" | "price";
type Group = { key: GroupKey; title: string; options: { value: string; label: string }[] };

/**
 * 筛选与排序（B-2.3：可叠加、每个值可直达 URL）
 * 移动端：吸顶「Filter (n)」按钮 → 底部抽屉，底部双按钮 Clear / Show N results
 * 桌面端：同一套分组渲染为侧栏，不做桌面专属交互
 *
 * 词条全部取当前语言（Q-02）：标签走 labelZh，价格档与排序走 messages。
 */
export function FilterControls({
  params,
  resultCount,
  basePath,
  locale,
}: {
  params: ListParams;
  resultCount: number;
  basePath: string;
  locale: Locale;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const m = getMessages(locale);

  const activeCount = countActiveFilters(params);

  const GROUPS: Group[] = [
    {
      key: "category",
      title: m.list.groupTitles.category,
      options: CATEGORY_TAGS.map((t) => ({ value: t.slug, label: tagLabel(t.slug, locale) })),
    },
    {
      key: "style",
      title: m.list.groupTitles.style,
      options: STYLE_TAGS.map((t) => ({ value: t.slug, label: tagLabel(t.slug, locale) })),
    },
    {
      key: "material",
      title: m.list.groupTitles.material,
      options: MATERIAL_TAGS.map((t) => ({ value: t.slug, label: tagLabel(t.slug, locale) })),
    },
    {
      key: "type",
      title: m.list.groupTitles.type,
      options: PRODUCT_TYPES.map((t) => ({ value: t.slug, label: tagLabel(t.slug, locale) })),
    },
    {
      key: "price",
      title: m.list.groupTitles.price,
      options: PRICE_BUCKETS.map((b) => ({
        value: b.id,
        label: m.list.priceBuckets[b.id as keyof typeof m.list.priceBuckets] ?? b.id,
      })),
    },
  ];

  const go = (next: ListParams) => {
    // 同一套 URL 口径，可分享可回退；replace 避免筛选塞满历史栈
    router.replace(`${basePath}${buildQueryString(next)}`, { scroll: false });
  };

  const onToggle = (key: GroupKey, value: string) => {
    const current = splitList(params[key]);
    const next = toggleValue(current, value);
    go({ ...params, [key]: next.length ? next.join(",") : undefined });
  };

  const clearAll = () => {
    go({ sort: params.sort });
  };

  const groups = (compact = false) => (
    <div className={compact ? "space-y-sp5" : "space-y-sp6"}>
      {GROUPS.map((group) => {
        const selected = splitList(params[group.key]);
        return (
          <fieldset key={group.key}>
            <legend className="text-aux uppercase tracking-[0.16em] text-muted">
              {group.title}
            </legend>
            <div className="mt-sp3 space-y-sp2">
              {group.options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex min-h-[44px] cursor-pointer items-center gap-sp3 text-body text-ink"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => onToggle(group.key, opt.value)}
                    className="h-4 w-4 accent-accent"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );

  return (
    <>
      {/* 移动端：吸顶筛选条 + 排序 */}
      <div className="sticky top-14 z-30 flex items-center justify-between gap-sp3 border-b border-line bg-bg/95 px-sp4 py-sp2 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 rounded-btn border border-line px-sp4 text-body text-ink"
          aria-expanded={open}
        >
          {m.list.filter} {activeCount > 0 ? `(${activeCount})` : ""}
        </button>
        <SortSelect params={params} basePath={basePath} locale={locale} />
      </div>

      {/* 桌面端：侧栏 */}
      <aside className="hidden lg:block lg:w-[220px] lg:shrink-0">
        <div className="flex items-baseline justify-between">
          <p className="text-aux uppercase tracking-[0.16em] text-muted">{m.list.filter}</p>
          {activeCount > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="text-aux text-muted hover:text-accent"
            >
              {m.list.clear}
            </button>
          ) : null}
        </div>
        <div className="mt-sp4">{groups()}</div>
      </aside>

      {/* 移动端底部抽屉 */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 fade-in"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={m.list.filters}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-card bg-bg px-sp5 pb-sp5 pt-sp4 fade-in"
          >
            <div className="flex items-center justify-between">
              <span className="text-aux uppercase tracking-[0.16em] text-muted">
                {m.list.filters}
              </span>
              <button
                type="button"
                aria-label={m.list.closeFilters}
                onClick={() => setOpen(false)}
                className="-mr-2 flex h-11 w-11 items-center justify-center"
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="mt-sp5">{groups(true)}</div>

            <div className="mt-sp5 flex gap-sp3">
              <button
                type="button"
                onClick={clearAll}
                className="h-12 flex-1 rounded-btn border border-line text-body text-ink"
              >
                {m.list.clear}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-12 flex-1 rounded-btn bg-accent text-body text-onAccent"
              >
                {m.list.showResults(resultCount)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
