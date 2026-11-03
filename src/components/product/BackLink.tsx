"use client";

import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "@/components/layout/icons";
import { hasReturnTarget } from "@/lib/scroll-return";

/**
 * 商品详情页的「返回」（2026-11-03）
 *
 * 为什么不用 `<Link href="/shop">`：
 * 用户是从列表点进来的，返回就该回到**刚才那一屏**，而不是列表顶部；
 * 只有走浏览器历史（router.back）才能把滚动位置一起带回去（见 ScrollReturnTracker）。
 *
 * 但 back() 有个坑：直接打开分享链接时站内没有上一页，back() 会把人送出站外，
 * 或者干脆什么也不发生。判断依据是"刚才有没有人从站内点进来"——
 * 点击商品链接时 ScrollReturnTracker 会留下一条记录，有记录才敢 back()。
 * （不读 history.state.idx：App Router 里根本没有这个字段，恒为 0。）
 */
export function BackLink({ label, fallbackHref }: { label: string; fallbackHref: string }) {
  const router = useRouter();

  const onClick = () => {
    if (hasReturnTarget()) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      // 44px 触达高度：移动端拇指点得中；-ml-sp2 让箭头与下方面包屑的左边缘对齐
      className="-ml-sp2 inline-flex h-11 items-center gap-sp2 rounded-btn px-sp2 text-body text-muted hover:text-accent"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      {label}
    </button>
  );
}
