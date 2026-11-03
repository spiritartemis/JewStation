"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  clearScrollMemory,
  currentUrl,
  readScrollMemory,
  writeScrollMemory,
} from "@/lib/scroll-return";

/**
 * 记住「离开列表时滚到哪儿了」，回来时放回原位（2026-11-03）
 *
 * 场景：在列表里滚到第三屏、点开某件商品、按返回 —— 期望回到第三屏那一行，
 * 而不是被打回页面顶部。浏览器的原生滚动恢复在这种页面上不可靠：
 * 列表是 RSC 渲染的，退回时图片还在懒加载，文档高度没长回来，scrollTo 会被截断。
 *
 * 做法刻意做得很轻：
 *  - 只在**点开商品链接**的那一刻记一次（含当时的 URL 与 scrollY），
 *    所以从首页正常进入列表时不会被莫名其妙地拽到半中间；
 *  - 回到同一条 URL 时恢复，读完即删，一次性；
 *  - 分几个时间点重试（图片陆续到位、高度在长），一旦到位或用户自己开始滚就停手。
 */

/** 恢复的重试点：懒加载图片补齐高度需要时间，一次 scrollTo 往往不到位 */
const RETRY_DELAYS = [0, 80, 200, 400, 700, 1100, 1600];

export function ScrollReturnTracker() {
  const pathname = usePathname();

  // 1) 记：点开商品链接的瞬间，把「当前地址 + 当前位置」存起来
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // 新标签页 / 中键 / 修饰键打开时不算"离开当前页"，不该记住位置
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = anchor.getAttribute("href") ?? "";
      // 只有去向是商品详情才记：点导航、点筛选不该触发滚动恢复
      if (!/\/products\/[^/?#]+/.test(href)) return;

      writeScrollMemory({ url: currentUrl(), y: window.scrollY, t: Date.now() });
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  // 2) 还：回到同一条地址时，把位置放回去
  useEffect(() => {
    const saved = readScrollMemory();
    if (!saved || saved.url !== currentUrl()) return;

    // 读完即删，避免下次从别处正常进入这条列表时也被拽到半中间
    clearScrollMemory();

    const target = saved.y;
    if (target <= 0) return;

    let done = false;
    const stop = () => {
      done = true;
    };
    // 用户一自己动手，就别再抢滚动条
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchstart", stop, { passive: true, once: true });
    window.addEventListener("keydown", stop, { once: true });

    const timers = RETRY_DELAYS.map((delay) =>
      window.setTimeout(() => {
        if (done) return;
        window.scrollTo(0, target);
        // 图片补齐高度后位置才真的能到位；差 4px 以内就算成功，收工
        if (Math.abs(window.scrollY - target) < 4) done = true;
      }, delay),
    );

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [pathname]);

  return null;
}
