import { FAQ_ITEMS } from "@/content/site-content";
import { JsonLdScript } from "@/components/JsonLd";
import { buildMetadata } from "@/lib/seo";
import { faqJsonLd } from "@/lib/structured-data";

/** FAQ（内容源自 src/content/site-content.ts，不硬编码在页面里） */
export const metadata = buildMetadata({
  title: "FAQ",
  description: "Shipping, returns, care, materials and order questions.",
  path: "/faq",
});

const PENDING_COUNT = FAQ_ITEMS.filter((i) => i.pending).length;

export default function FaqPage() {
  return (
    <div className="shell max-w-[68ch] py-sp6">
      {/* 只提交已确定的答案；带待确认标记的条目不进结构化数据 */}
      <JsonLdScript data={faqJsonLd(FAQ_ITEMS)} />

      <h1 className="font-serif text-h1 text-ink">FAQ</h1>

      <div className="mt-sp5 divide-y divide-line border-y border-line">
        {FAQ_ITEMS.map((item) => (
          <details key={item.id} id={item.id} className="group">
            <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-sp4 text-body text-ink">
              <span>{item.question}</span>
              <span className="text-muted" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="pb-sp2 text-body text-muted">{item.answer}</p>
            {/* 待确认项在页面上就地标出，避免读者把未定口径当最终答案 */}
            {item.pending ? (
              <p className="mb-sp4 rounded-btn border border-warn/40 bg-warn/5 px-sp3 py-sp2 text-aux text-warn">
                Pending owner decision — {item.pending}
              </p>
            ) : null}
          </details>
        ))}
      </div>

      {PENDING_COUNT > 0 ? (
        <p className="mt-sp6 text-aux text-muted">
          {PENDING_COUNT} answer{PENDING_COUNT === 1 ? "" : "s"} marked “Pending owner decision” must be
          settled before launch.
        </p>
      ) : null}
    </div>
  );
}
