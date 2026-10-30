import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

/**
 * 占位页：路由已建、页面未实现时使用，避免导航 404。
 * m-1b 各任务完成后会被真实页面替换。
 */
export function PlaceholderPage({
  title,
  description,
  locale,
}: {
  title: string;
  description: string;
  locale: Locale;
}) {
  const m = getMessages(locale);

  return (
    <div className="shell py-sp6">
      <h1 className="font-serif text-h1 text-ink">{title}</h1>
      <p className="mt-sp3 max-w-[52ch] text-body text-muted">{description}</p>
      <Link
        href={localePath(locale, "/shop")}
        className="mt-sp5 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent"
      >
        {m.cart.browseAll}
      </Link>
    </div>
  );
}
