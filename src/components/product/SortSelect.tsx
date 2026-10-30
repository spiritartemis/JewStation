"use client";

import { useRouter } from "next/navigation";
import { SORT_OPTIONS, buildQueryString, type ListParams } from "@/lib/filters";
import { getMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";

/**
 * 排序选择器（B-2.3 的配套）
 *
 * 移动端与桌面端共用同一个实现：移动端在吸顶筛选条里，桌面端在列表头部右侧。
 * 变更即写 URL（可分享、可回退），不额外维护客户端状态。
 */
export function SortSelect({
  params,
  basePath,
  locale,
}: {
  params: ListParams;
  basePath: string;
  locale: Locale;
}) {
  const router = useRouter();
  const m = getMessages(locale);
  const value = params.sort ?? "newest";

  const onChange = (next: string) => {
    // newest 是默认值，不回写 URL，保持链接干净
    const sort = next === "newest" ? undefined : next;
    router.replace(`${basePath}${buildQueryString({ ...params, sort })}`, { scroll: false });
  };

  return (
    <label className="flex items-center gap-sp2 text-body text-muted">
      <span className="sr-only">{m.list.sortAria}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-btn border border-line bg-surface px-sp3 text-body text-ink"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {m.list.sort[o.key]}
          </option>
        ))}
      </select>
    </label>
  );
}
