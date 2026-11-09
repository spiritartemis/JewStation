"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildQueryString, splitList, toggleValue, type ListParams } from "@/lib/filters";
import { CATEGORY_TAGS, tagLabel } from "@/lib/tags";
import { getMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";

/**
 * 搜索页的品类勾选（0.4.10）
 *
 * 站长要求把列表页左侧那排分类勾选搬到「点顶栏搜索按钮进入的页面」。
 * 这里沿用列表页同一套 URL 口径（`category=a,b`），所以：
 *  · 勾选结果可分享、可回退；
 *  · 与搜索词 q 叠加（服务端 getFilteredProducts 取交集）；
 *  · 搜索引擎/无 JS 场景仍能从带参数的 URL 得到同样结果。
 *
 * 乐观选中态：点击后勾选框立刻响应，不必等服务端把新页面送回来。
 * sharecode 由 SharecodeKeeper 统一补到 history 与链接上，这里不用拼。
 */
export function SearchCategoryFilters({
  params,
  basePath,
  locale,
}: {
  params: ListParams;
  basePath: string;
  locale: Locale;
}) {
  const m = getMessages(locale);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const selected = optimistic ?? splitList(params.category);

  // 服务端新一轮结果到了，本地乐观值作废
  useEffect(() => {
    setOptimistic(null);
  }, [params.category]);

  const toggle = (slug: string) => {
    const next = toggleValue(selected, slug);
    setOptimistic(next);
    const patch: ListParams = {
      ...params,
      category: next.length ? next.join(",") : undefined,
    };
    startTransition(() => {
      router.replace(`${basePath}${buildQueryString(patch)}`, { scroll: false });
    });
  };

  return (
    <fieldset className="mt-sp4">
      <legend className="text-aux uppercase tracking-[0.16em] text-muted">
        {m.search.categoryLabel}
      </legend>
      <p className="mt-sp1 text-aux text-muted">{m.search.categoryHint}</p>
      <div className="mt-sp3 flex flex-wrap gap-sp2">
        {CATEGORY_TAGS.map((t) => {
          const on = selected.includes(t.slug);
          return (
            <label
              key={t.slug}
              className={`inline-flex min-h-[40px] cursor-pointer items-center gap-sp2 rounded-btn border px-sp3 text-body transition-colors duration-fade ${
                on
                  ? "border-accent bg-accentWeak text-ink"
                  : "border-line bg-surface text-ink hover:border-accent"
              }`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(t.slug)}
                className="h-4 w-4 accent-accent"
              />
              {tagLabel(t.slug, locale)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
