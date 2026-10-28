import Link from "next/link";

/**
 * 占位页：路由已建、页面未实现时使用，避免导航 404。
 * m-1b 各任务完成后会被真实页面替换。
 */
export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="shell py-sp6">
      <h1 className="font-serif text-h1 text-ink">{title}</h1>
      <p className="mt-sp3 max-w-[52ch] text-body text-muted">{description}</p>
      <Link
        href="/shop"
        className="mt-sp5 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent"
      >
        Browse all products
      </Link>
    </div>
  );
}
