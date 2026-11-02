"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildQueryString, type ListParams } from "@/lib/filters";
import { SearchIcon, CloseIcon } from "@/components/layout/icons";
import { getMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";

/**
 * 列表页内的搜索框（列表头部，桌面端在排序左侧）
 *
 * 与顶栏的搜索入口不同：这里**不跳走**，而是在当前列表里就地收窄，
 * 且与已选的品类/风格/价格等条件叠加 —— 站长在筛选一半时想再按词找，
 * 不该被丢到 /search 重新开始。
 *
 * 词写进 URL 的 `q`（可分享、可回退），排序与筛选其它参数原样带过去。
 */
export function ListSearch({
  params,
  basePath,
  locale,
  className = "",
}: {
  params: ListParams;
  basePath: string;
  locale: Locale;
  className?: string;
}) {
  const router = useRouter();
  const m = getMessages(locale);
  const [value, setValue] = useState(params.q ?? "");
  const [isPending, startTransition] = useTransition();

  // 浏览器前进/后退、或点「清除」后，把输入框对齐回 URL
  useEffect(() => {
    setValue(params.q ?? "");
  }, [params.q]);

  const go = (next: string) => {
    const q = next.trim();
    startTransition(() => {
      router.replace(`${basePath}${buildQueryString({ ...params, q: q || undefined })}`, {
        scroll: false,
      });
    });
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
      className={className}
    >
      <label className="relative flex items-center">
        <span className="sr-only">{m.list.searchAria}</span>
        <SearchIcon className="pointer-events-none absolute left-sp3 h-4 w-4 text-muted" />
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={m.list.searchPlaceholder}
          aria-busy={isPending}
          className="h-11 w-full rounded-btn border border-line bg-surface pl-10 pr-9 text-body text-ink placeholder:text-muted transition-colors focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              go("");
            }}
            aria-label={m.list.clearSearch}
            className="absolute right-sp2 flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </label>
    </form>
  );
}
