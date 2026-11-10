"use client";

import { useEffect } from "react";
import { CONSENT_COOKIE, parseConsent } from "@/lib/privacy";

/**
 * 商品浏览上报（0.5.0 / 1.0-03）
 *
 * 只有三件事同时成立才上报：用户已同意个性化、页面是商品详情、同一会话没报过这件。
 * 任一条不满足就静默退出——拒绝追踪的用户不该产生任何请求（B-4.2 / B-4.5）。
 *
 * 用 sessionStorage 去重而不是依赖服务端：来回翻同一件商品不该刷出一串重复记录，
 * 而且这个去重键本身不含任何个人信息，清掉 cookie 也不会留下可识别的痕迹。
 */
export function ViewTracker({ slug, tags }: { slug: string; tags: string[] }) {
  // tags 是数组，直接进依赖会每次渲染都触发；用拼好的字符串做稳定键
  const tagKey = tags.join(",");

  useEffect(() => {
    if (!slug) return;

    const hit = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
    const scope = parseConsent(hit ? decodeURIComponent(hit.slice(CONSENT_COOKIE.length + 1)) : null);
    if (!scope?.personalisation) return;

    const seenKey = `mm.viewed.${slug}`;
    try {
      if (sessionStorage.getItem(seenKey)) return;
      sessionStorage.setItem(seenKey, "1");
    } catch {
      // 隐私模式下 sessionStorage 可能直接抛错：退化成「每次都报」，服务端每秒只留一条，
      // 影响仅仅是多几条重复记录，比不记录更符合预期
    }

    void fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, tags }),
      cache: "no-store",
      keepalive: true,
    }).catch(() => {
      /* 上报失败不打扰用户 */
    });
  }, [slug, tagKey]);

  return null;
}
