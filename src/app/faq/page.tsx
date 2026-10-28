import { FAQ_ITEMS } from "@/content/site-content";
import { buildMetadata } from "@/lib/seo";

/** FAQ（内容源自 src/content/site-content.ts，不硬编码在页面里） */
export const metadata = buildMetadata({
  title: "FAQ",
  description: "Shipping, returns, care, materials and order questions.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <div className="shell max-w-[68ch] py-sp6">
      <h1 className="font-serif text-h1 text-ink">FAQ</h1>

      <div className="mt-sp5 divide-y divide-line border-y border-line">
        {FAQ_ITEMS.map((item) => (
          <details key={item.id} id={item.id} className="group">
            <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-sp4 text-body text-ink">
              {item.question}
              <span className="text-muted">+</span>
            </summary>
            <p className="pb-sp4 text-body text-muted">{item.answer}</p>
          </details>
        ))}
      </div>

      <p className="mt-sp6 text-aux text-muted">
        Answers marked “【待确认】” need the store owner’s decision before launch.
      </p>
    </div>
  );
}
