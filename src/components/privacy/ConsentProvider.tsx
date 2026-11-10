"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import {
  CONSENT_COOKIE,
  consentCookieMaxAge,
  parseConsent,
  serializeConsent,
  type ConsentScope,
} from "@/lib/privacy";

/**
 * Cookie 同意（0.5.0 / m-1d 1.0-01）
 *
 * 界面只有两处入口，同一份状态：
 * 1. 首次访问的底部同意条 —— 三个动作：全部接受 / 仅必要 / 管理偏好；
 * 2. 页脚的「Cookie 偏好」—— 随时回来改，也是「撤回」的正式入口（B-4.3）。
 *
 * 为什么状态放 cookie 而不是 localStorage：
 * cookie 能被服务端读到，后续若要按同意状态决定是否下发个性化推荐，
 * 服务端就有依据；localStorage 只有浏览器自己看得到。
 *
 * 首屏渲染一律按「未决定」走：挂载后才读 cookie，避免服务端与客户端输出不一致
 * 导致 hydration 报错。代价是同意条会晚一帧出现，这不影响任何功能。
 */

type ConsentState = {
  decided: boolean;
  personalisation: boolean;
  /** 打开偏好面板（页脚入口用） */
  openPanel: () => void;
  /** 当前面板是否打开 */
  panelOpen: boolean;
};

const ConsentContext = createContext<ConsentState | null>(null);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function writeCookie(name: string, value: string) {
  // 不加 secure：本地调试走 http，加了就写不进去。线上由服务端 Set-Cookie 补上 Secure。
  document.cookie = `${name}=${value}; path=/; max-age=${consentCookieMaxAge()}; samesite=lax`;
}

/**
 * 把选择同步到服务端。
 * 失败**不打断**用户：本地 cookie 已记下选择，界面立刻生效，
 * 只是个性化这次不生效——下次进偏好面板再点一次保存即可。
 */
async function pushToServer(action: "grant" | "update" | "revoke", personalisation: boolean) {
  try {
    await fetch("/api/privacy/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, personalisation }),
      cache: "no-store",
    });
  } catch {
    /* 网络失败按「暂不生效」处理，不弹错误 */
  }
}

export function ConsentProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const m = getMessages(locale);
  const [hydrated, setHydrated] = useState(false);
  const [scope, setScope] = useState<ConsentScope | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState<"saved" | "revoked" | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const parsed = parseConsent(readCookie(CONSENT_COOKIE));
    setScope(parsed);
    setHydrated(true);

    // 状态自愈：本地记着「已同意个性化」，但服务端可能没有对应访客（云端抖动、或当时没建成）。
    // 每次整页加载补一次 update —— 有访客就续期，没有就补建，本身不采集任何新数据。
    // 不去判断 mm_vid 是否存在：它是 HttpOnly，前端本来就看不到，不该为了判断去放宽它。
    if (parsed?.personalisation) void pushToServer("update", true);
  }, []);

  const persist = useCallback(
    async (next: ConsentScope) => {
      const wasPersonal = scope?.personalisation === true;
      writeCookie(CONSENT_COOKIE, serializeConsent(next));
      setScope(next);

      // 从「有」到「没有」= 撤回；否则是 grant / update
      const action = next.personalisation ? (wasPersonal ? "update" : "grant") : "revoke";
      await pushToServer(action, next.personalisation);

      setSavedFlash(next.personalisation ? "saved" : "revoked");
      window.setTimeout(() => setSavedFlash(null), 4000);
    },
    [scope],
  );

  const acceptAll = useCallback(() => {
    setPanelOpen(false);
    void persist({ necessary: true, personalisation: true });
  }, [persist]);

  const essentialOnly = useCallback(() => {
    setPanelOpen(false);
    void persist({ necessary: true, personalisation: false });
  }, [persist]);

  const openPanel = useCallback(() => setPanelOpen(true), []);

  useEffect(() => {
    if (!panelOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const value = useMemo<ConsentState>(
    () => ({
      decided: scope !== null,
      personalisation: scope?.personalisation === true,
      openPanel,
      panelOpen,
    }),
    [scope, openPanel, panelOpen],
  );

  // 未挂载完：同意条与面板都先不渲染（此时还不知道用户选过没有，渲染任何东西都可能闪一下），
  // 但 **children 必须照常输出** —— 这里返回 null 会把整站变成白屏。
  if (!hydrated) {
    return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
  }

  const showBanner = scope === null && !panelOpen;

  return (
    <ConsentContext.Provider value={value}>
      {children}

      {showBanner ? (
        <div
          role="region"
          aria-label={m.privacy.bannerTitle}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/98 backdrop-blur"
        >
          <div className="shell flex flex-col gap-sp3 py-sp4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-[62ch]">
              <p className="text-aux uppercase tracking-[0.16em] text-muted">
                {m.privacy.bannerTitle}
              </p>
              <p className="mt-sp2 text-body leading-relaxed text-ink">{m.privacy.bannerBody}</p>
              <Link
                href={localePath(locale, "/policies/cookies")}
                className="mt-sp1 inline-block text-aux text-muted underline hover:text-accent"
              >
                {m.privacy.policyLink}
              </Link>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-sp2">
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="h-11 rounded-btn border border-line px-sp4 text-body text-ink hover:border-accent hover:text-accent"
              >
                {m.privacy.manage}
              </button>
              <button
                type="button"
                onClick={essentialOnly}
                className="h-11 rounded-btn border border-line px-sp4 text-body text-ink hover:border-accent hover:text-accent"
              >
                {m.privacy.essentialOnly}
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className="h-11 rounded-btn bg-ink px-sp4 text-body text-bg hover:opacity-90"
              >
                {m.privacy.acceptAll}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {panelOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-sp3 lg:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-panel-title"
            className="w-full max-w-[560px] rounded-card border border-line bg-bg p-sp5 shadow-lg"
          >
            <div className="flex items-start justify-between gap-sp4">
              <h2 id="consent-panel-title" className="font-serif text-h3 text-ink">
                {m.privacy.panelTitle}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label={m.privacy.close}
                className="-mt-1 h-9 w-9 rounded-btn text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
            <p className="mt-sp2 text-aux leading-relaxed text-muted">{m.privacy.panelIntro}</p>

            <div className="mt-sp4 space-y-sp4">
              <div className="rounded-btn border border-line p-sp3">
                <div className="flex items-center justify-between gap-sp3">
                  <p className="text-body font-medium text-ink">{m.privacy.essentialTitle}</p>
                  <span className="text-aux uppercase tracking-[0.14em] text-muted">
                    {m.privacy.essentialAlways}
                  </span>
                </div>
                <p className="mt-sp2 text-aux leading-relaxed text-muted">
                  {m.privacy.essentialBody}
                </p>
              </div>

              <div className="rounded-btn border border-line p-sp3">
                <div className="flex items-center justify-between gap-sp3">
                  <p className="text-body font-medium text-ink">{m.privacy.personalTitle}</p>
                  <label className="flex cursor-pointer items-center gap-sp2">
                    <input
                      type="checkbox"
                      checked={scope?.personalisation === true}
                      onChange={(e) => setScope({ necessary: true, personalisation: e.target.checked })}
                      className="h-5 w-5 accent-[var(--ink)]"
                    />
                    <span className="text-aux text-muted">{m.privacy.personalTitle}</span>
                  </label>
                </div>
                <p className="mt-sp2 text-aux leading-relaxed text-muted">
                  {m.privacy.personalBody}
                </p>
                <p className="mt-sp1 text-aux text-muted">{m.privacy.retention}</p>
              </div>
            </div>

            <div className="mt-sp5 flex items-center justify-end gap-sp2">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="h-11 rounded-btn border border-line px-sp4 text-body text-ink hover:border-accent hover:text-accent"
              >
                {m.privacy.close}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPanelOpen(false);
                  void persist({ necessary: true, personalisation: scope?.personalisation === true });
                }}
                className="h-11 rounded-btn bg-ink px-sp4 text-body text-bg hover:opacity-90"
              >
                {m.privacy.save}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 保存 / 撤回的反馈用 role=status：读屏会播报，视觉上 4 秒后自动消失 */}
      {savedFlash ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 rounded-btn border border-line bg-surface px-sp4 py-sp2 text-aux text-ink shadow-lg"
        >
          {savedFlash === "revoked" ? m.privacy.revoked : m.privacy.saved}
        </div>
      ) : null}
    </ConsentContext.Provider>
  );
}

/** 页脚入口：打开偏好面板。没有 Provider（比如未挂载）时不渲染，避免死按钮。 */
export function useConsent(): ConsentState | null {
  return useContext(ConsentContext);
}
