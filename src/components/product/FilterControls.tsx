"use client";

import { useEffect, useState, useTransition } from "react";
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
  const [isPending, startTransition] = useTransition();
  /**
   * 乐观选中态（2026-10-30）
   *
   * 勾选框原先的 checked 直接读服务端 params：点一下要等服务端把新页面送回来，
   * 勾选框才打勾 —— 在部署平台上这一来一回常常要一两秒，手感像"卡住了"。
   * 这里先本地记下"用户刚刚勾了什么"，勾选框立刻响应；服务端数据回来后清空。
   */
  const [optimistic, setOptimistic] = useState<Partial<Record<GroupKey, string[]>> | null>(null);
  const m = getMessages(locale);

  // params 已是新一轮服务端结果，本地乐观值作废
  useEffect(() => {
    setOptimistic(null);
  }, [params.category, params.style, params.material, params.type, params.price]);

  const selectedOf = (key: GroupKey): string[] =>
    optimistic?.[key] ?? splitList(params[key]);

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
    startTransition(() => {
      router.replace(`${basePath}${buildQueryString(next)}`, { scroll: false });
    });
  };

  const onToggle = (key: GroupKey, value: string) => {
    // 以乐观值为基准，连点多个维度也不会互相覆盖
    const current = selectedOf(key);
    const next = toggleValue(current, value);
    const merged = { ...(optimistic ?? {}) } as Partial<Record<GroupKey, string[]>>;
    merged[key] = next;

    const patch: ListParams = { ...params };
    (Object.keys(merged) as GroupKey[]).forEach((k) => {
      const v = merged[k];
      patch[k] = v && v.length ? v.join(",") : undefined;
    });

    setOptimistic(merged);
    go(patch);
  };

  const clearAll = () => {
    const patch: ListParams = { sort: params.sort };
    (["category", "style", "material", "type", "price"] as GroupKey[]).forEach((k) => {
      patch[k] = undefined;
    });
    // 立刻把所有勾选框清空（含价格档），服务端回来前右侧仍是旧列表，
    // 但不会再出现"取消了一半、另一半还勾着"的错位
    setOptimistic({
      category: [],
      style: [],
      material: [],
      type: [],
      price: [],
    });
    go(patch);
  };

  const groups = (compact = false) => (
    <div className={compact ? "space-y-sp5" : "space-y-sp6"}>
      {GROUPS.map((group) => {
        const selected = selectedOf(group.key);
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
          aria-busy={isPending}
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
            // 遮罩用中性黑而非 ink：深色版里 ink 是浅色字色，拿它当遮罩会把底提亮
            className="absolute inset-0 bg-black/55 fade-in"
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
