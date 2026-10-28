import Link from "next/link";
import { FOOTER_GROUPS, SITE } from "@/lib/site";

/**
 * 全站页脚（01 §3.3）：四组链接 + 订阅入口占位 + 版本与更新时间。
 * 订阅：V1.0 才实现，本线只占位且不外链（m-1b bootstrap §2 订阅入口留位）。
 */
export function SiteFooter() {
  return (
    <footer className="mt-sp6 border-t border-line bg-bg">
      <div className="shell py-sp6">
        <div className="grid grid-cols-2 gap-sp6 md:grid-cols-4">
          {FOOTER_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="text-aux uppercase tracking-[0.16em] text-muted">{group.title}</p>
              <ul className="mt-sp3 space-y-sp2">
                {group.items.map((item) => (
                  <li key={`${group.title}-${item.label}`}>
                    <Link href={item.href} className="text-body text-ink hover:text-accent">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 订阅入口占位：V1.0 实现，此处不可提交、不跳转（留位） */}
        <div className="mt-sp6 border-t border-line pt-sp5">
          <p className="text-aux uppercase tracking-[0.16em] text-muted">Newsletter</p>
          <div className="mt-sp3 flex max-w-[420px] items-center gap-sp2">
            <input
              type="email"
              disabled
              placeholder="Email address"
              aria-disabled="true"
              className="h-11 flex-1 rounded-btn border border-line bg-surface px-sp3 text-body text-muted"
            />
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="h-11 rounded-btn border border-line px-sp4 text-body text-muted"
            >
              Join
            </button>
          </div>
          <p className="mt-sp2 text-aux text-muted">
            Newsletter launches with V1.0 — this slot is a placeholder.
          </p>
        </div>

        <div className="mt-sp6 flex flex-col gap-sp2 border-t border-line pt-sp5 text-aux text-muted md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.brandName}. {SITE.tagline}.
          </p>
          {/* 版本号与更新时间：每次发布必须同步变更（见 src/lib/site.ts 顶部约定） */}
          <p>
            Version {SITE.version} · Updated {SITE.updatedAt}
          </p>
        </div>
      </div>
    </footer>
  );
}
