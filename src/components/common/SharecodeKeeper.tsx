"use client";

import { useEffect } from "react";

/**
 * 分享参数保持器（2026-11-05）
 *
 * 背景：站点托管在分享型网关上，**请求不带 `?sharecode=` 会被网关直接 403**
 * （连 HTML 都到不了 Next，middleware 兜不住）。而站内链接的 href 都是干净的
 * `/shop`、`/products/x` —— Next 客户端跳转后地址栏就不带参数了，用户一旦刷新、
 * 复制地址、或在新标签打开，就再也打不开，表现为「not found / 打不开」。
 *
 * 四道保险，都不需要改任何一处的 Link：
 *  1. 记下参数（localStorage，30 天）：新标签直接输 /shop 也能补回来
 *  2. 拦 history.pushState / replaceState：**任何**路由跳转（含列表页筛选、排序
 *     这类自己重建 query 的 router.replace）写进地址栏时都把参数补上
 *  3. 给站内 <a href="/..."> 补参数，并盯住 href 属性 —— React 重渲染会把
 *     href 覆盖回无参数版本，只看 childList 会漏
 *  4. 首次进入时把当前地址栏补上
 *
 * 刻意不用 useSearchParams：它会让整棵树退出静态预渲染（0.3.11 刚把全站静态化
 * 修好，不能为了一个参数退回去）。本组件不读任何 Next 的请求期 API。
 */

const PARAM = "sharecode";
const STORE_KEY = "mm:sharecode";
/** 30 天。分享参数不常变，但留个过期口子，换新链接时旧值不会一直粘住 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function readStored(): string | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const { v, t } = JSON.parse(raw) as { v?: string; t?: number };
    if (!v || typeof t !== "number" || Date.now() - t > MAX_AGE_MS) return null;
    return v;
  } catch {
    return null;
  }
}

function store(value: string) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ v: value, t: Date.now() }));
  } catch {
    // 隐私模式 / 存储被禁用：退化成只在本次导航内生效，不抛错
  }
}

/** 给同源 URL 补参数；已带参数或非同源则返回 null（表示不用动） */
function withParam(url: string | URL, code: string): string | null {
  try {
    const u = new URL(url.toString(), window.location.origin);
    if (u.origin !== window.location.origin) return null;
    if (u.searchParams.get(PARAM)) return null;
    // 静态资源 / API 不必带
    if (u.pathname.startsWith("/_next/") || u.pathname.startsWith("/api/")) return null;
    u.searchParams.set(PARAM, code);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

export function SharecodeKeeper() {
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(PARAM);
    if (fromUrl) store(fromUrl);
    const code = fromUrl || readStored();
    if (!code) return;

    const fixAnchor = (a: Element) => {
      const raw = a.getAttribute("href");
      if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return;
      const next = withParam(raw, code);
      if (next) a.setAttribute("href", next);
    };

    const fixTree = (root: ParentNode) => {
      if (root instanceof Element) fixAnchor(root);
      root.querySelectorAll?.('a[href^="/"]').forEach(fixAnchor);
    };

    // —— 第 2 道：拦路由写入 ——
    const origPush = window.history.pushState;
    const origReplace = window.history.replaceState;
    window.history.pushState = function (state, title, url) {
      const next = url == null ? null : withParam(url, code);
      return origPush.call(this, state, title, next ?? url);
    };
    window.history.replaceState = function (state, title, url) {
      const next = url == null ? null : withParam(url, code);
      return origReplace.call(this, state, title, next ?? url);
    };

    // —— 第 4 道：当前地址栏 ——
    // 用原始 replaceState，避免上面那层包装把 sharecode 判断绕回来；
    // history.state 原样回填，别把 Next 的路由状态冲掉
    if (!fromUrl) {
      const patched = withParam(window.location.href, code);
      if (patched) origReplace.call(window.history, window.history.state, "", patched);
    }

    // —— 第 3 道：链接 + 属性观察 ——
    fixTree(document);
    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.type === "attributes") {
          if (mut.target instanceof Element) fixAnchor(mut.target);
          continue;
        }
        mut.addedNodes.forEach((node) => {
          if (node instanceof Element) fixTree(node);
        });
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });

    return () => {
      observer.disconnect();
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    };
  }, []);

  return null;
}
