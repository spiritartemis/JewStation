import Link from "next/link";

/**
 * 首页 Hero（B-2.2 第一区块）
 * 正式上线须用实拍场景图（Q-16 待定）；未拿到素材前只留占位块，不拿 AI 图冒充素材。
 */
export function Hero() {
  return (
    <section className="relative">
      <div className="flex aspect-[4/5] w-full items-center justify-center bg-accentWeak md:aspect-[16/9]">
        <span className="text-aux uppercase tracking-[0.16em] text-muted">
          Hero photo pending
        </span>
      </div>

      <div className="shell pointer-events-none absolute inset-x-0 bottom-sp5">
        <p className="max-w-[24ch] font-serif text-h1 text-ink">Made by hand, worn every day</p>
        <Link
          href="/collections/new"
          className="pointer-events-auto mt-sp3 inline-flex h-12 items-center justify-center rounded-btn bg-accent px-sp5 text-body text-white"
        >
          Shop new
        </Link>
      </div>
    </section>
  );
}
