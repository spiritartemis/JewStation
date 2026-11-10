"use client";

import { useConsent } from "./ConsentProvider";

/**
 * 页脚「Cookie 偏好」入口（0.5.0）
 *
 * 这是撤回的**正式入口**（B-4.3）：同意条只在首次访问出现一次，
 * 用户之后想改只能靠这个入口。所以它必须一直在页脚可见，不能藏进二级菜单。
 * Provider 未挂载时返回 null，宁可少一个入口，也不放一个点了没反应的按钮。
 */
export function CookiePreferencesLink({ label }: { label: string }) {
  const consent = useConsent();
  if (!consent) return null;

  return (
    <button
      type="button"
      onClick={consent.openPanel}
      className="text-left text-body text-ink hover:text-accent"
    >
      {label}
    </button>
  );
}
