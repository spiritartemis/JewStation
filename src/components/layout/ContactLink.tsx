"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CloseIcon } from "@/components/layout/icons";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 页脚「联系我们」（2026-11-02）
 *
 * 原来这里是一个裸 `<Link href="mailto:hello@example.com">`：
 *  - 地址是占位的，写过去没人收；
 *  - 而且 mailto 是否"点得动"取决于这台设备有没有配默认邮件客户端，
 *    没配的话浏览器什么也不做，表现就是"点了没反应"。
 *
 * 现在改成受控弹窗：
 *  - 邮箱已确认 → 显示地址 + 一键复制（剪贴板失败时退化为选中文本），
 *    「用邮件应用打开」只作为次要选项，不把成败押在系统客户端上；
 *  - 邮箱未确认 → 明确说明"还没定下来"，并给一条能立刻走的替代路径（常见问题），
 *    而不是留一个点了没反应的链接。
 *
 * 交互口径与筛选抽屉一致：Esc 关闭、点遮罩关闭、打开时锁滚动、初始焦点落在关闭按钮。
 */
export function ContactLink({
  locale,
  email,
  label,
}: {
  locale: Locale;
  email: string | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const m = getMessages(locale);
  const closeRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLParagraphElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 关掉就复位，下次打开不会还停在"已复制"
  useEffect(() => {
    if (open) return;
    setCopied(false);
  }, [open]);

  const copyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 非安全上下文 / 用户拒权时 clipboard 会抛错：退回到「选中文本」，
      // 至少能让人手动 ⌘C，而不是按下去没反应
      const node = emailRef.current;
      const selection = window.getSelection();
      if (!node || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="-my-0.5 text-left text-body text-ink hover:text-accent"
      >
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <div
            // 遮罩用中性黑：深色版里 ink 是浅色字色，拿它当遮罩会把底提亮
            className="absolute inset-0 bg-black/55 fade-in"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative m-sp4 w-full max-w-[440px] rounded-card border border-line bg-bg p-sp5 shadow-[0_18px_60px_rgba(0,0,0,0.45)] fade-in"
          >
            <div className="flex items-start justify-between gap-sp3">
              {/* 字号只有 display / h1 / h2 / body / aux 五档，没有 h3 —— 别凭空写 */}
              <h2 id={titleId} className="font-serif text-h1 text-ink">
                {m.contact.title}
              </h2>
              <button
                ref={closeRef}
                type="button"
                aria-label={m.contact.close}
                onClick={() => setOpen(false)}
                className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center text-ink"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>

            {email ? (
              <>
                <p className="mt-sp3 text-body text-muted">{m.contact.intro}</p>
                <p className="mt-sp4 text-aux uppercase tracking-[0.16em] text-muted">
                  {m.contact.emailLabel}
                </p>
                {/* 邮箱做成「可复制的字段」而不是一行普通正文：它是这个弹窗唯一的信息主体，
                    同时给 select-all，复制按钮失效时也能直接选中 */}
                <p
                  ref={emailRef}
                  className="mt-sp2 select-all break-all rounded-btn border border-line bg-surface px-sp3 py-sp2 text-h2 text-ink"
                >
                  {email}
                </p>
                <div className="mt-sp5 flex flex-col gap-sp3 sm:flex-row">
                  <button
                    type="button"
                    onClick={copyEmail}
                    className="flex h-11 flex-1 items-center justify-center rounded-btn bg-accent text-body text-onAccent"
                  >
                    {copied ? m.contact.copied : m.contact.copy}
                  </button>
                  <a
                    href={`mailto:${email}`}
                    className="flex h-11 flex-1 items-center justify-center rounded-btn border border-line text-body text-ink hover:border-accent hover:text-accent"
                  >
                    {m.contact.openMail}
                  </a>
                </div>
              </>
            ) : (
              <>
                <p className="mt-sp3 text-h2 text-ink">{m.contact.unavailableTitle}</p>
                <p className="mt-sp3 text-body text-muted">{m.contact.unavailableBody}</p>
                <div className="mt-sp5 flex flex-col gap-sp3 sm:flex-row">
                  <Link
                    href={localePath(locale, "/faq")}
                    onClick={() => setOpen(false)}
                    className="flex h-11 flex-1 items-center justify-center rounded-btn bg-accent text-body text-onAccent"
                  >
                    {m.contact.readFaq}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-11 flex-1 items-center justify-center rounded-btn border border-line text-body text-ink"
                  >
                    {m.contact.close}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
