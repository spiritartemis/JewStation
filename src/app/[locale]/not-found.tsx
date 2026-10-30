import Link from "next/link";

/**
 * 404
 *
 * 局限说明：App Router 的 not-found.tsx 拿不到 params，也就判定不了当前语言，
 * 所以这里**中英并排**给两行，用户至少能读懂其中一行，也不会出现「英文站里蹦中文」的错位感。
 * 需要精确语言时可改用 /[locale]/not-found 之外的 catch-all 方案，代价是所有未知路径都落到动态段，
 * 对静态站不划算。
 */
export default function NotFound() {
  return (
    <div className="shell py-sp6">
      <h1 className="font-serif text-h1 text-ink">404 · Page not found</h1>
      <p className="mt-sp3 text-body text-muted">页面不存在 · The page you are looking for does not exist or has moved.</p>
      <div className="mt-sp5 flex flex-wrap gap-sp3">
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-onAccent"
        >
          回到首页 / Back home
        </Link>
        <Link
          href="/shop"
          className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
        >
          全部商品 / Browse all products
        </Link>
      </div>
    </div>
  );
}
