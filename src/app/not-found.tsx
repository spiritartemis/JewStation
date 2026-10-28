import Link from "next/link";

export default function NotFound() {
  return (
    <div className="shell py-sp6">
      <h1 className="font-serif text-h1 text-ink">Page not found</h1>
      <p className="mt-sp3 text-body text-muted">
        The page you are looking for does not exist or has moved.
      </p>
      <div className="mt-sp5 flex gap-sp4">
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-white"
        >
          Back home
        </Link>
        <Link
          href="/shop"
          className="inline-flex h-12 items-center justify-center rounded-btn border border-line px-sp5 text-body text-ink"
        >
          Browse all products
        </Link>
      </div>
    </div>
  );
}
