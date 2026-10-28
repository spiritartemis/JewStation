/**
 * 订阅入口占位（B-2.2 末位区块：安静的订阅入口）
 * 属 m-1d 范围：本线只留位，表单不可提交、不跳转。
 */
export function NewsletterSlot() {
  return (
    <section className="mt-sp6 border-t border-line">
      <div className="shell py-sp6">
        <p className="text-aux uppercase tracking-[0.16em] text-muted">Join our list</p>
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
        <p className="mt-sp2 text-aux text-muted">Subscription launches with V1.0.</p>
      </div>
    </section>
  );
}
