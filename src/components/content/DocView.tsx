import type { Doc } from "@/content/types";

/**
 * 内容源渲染器（B-2.8）
 * 未审核的政策文档顶部显式标注，避免被误当作可发布文本（B-1.8）。
 */
export function DocView({ doc }: { doc: Doc }) {
  return (
    <article className="shell max-w-[68ch] py-sp6">
      <h1 className="font-serif text-h1 text-ink">{doc.title}</h1>

      {doc.status === "pending_review" ? (
        <p className="mt-sp3 rounded-btn border border-warn/40 bg-warn/5 px-sp3 py-sp2 text-aux text-warn">
          Draft — pending business/legal review. Not for publication until approved.
        </p>
      ) : null}

      <div className="mt-sp5 space-y-sp4">
        {doc.blocks.map((block, i) => {
          if (block.type === "h") {
            return (
              <h2 key={i} className="pt-sp2 text-h2 text-ink">
                {block.text}
              </h2>
            );
          }
          if (block.type === "ul") {
            return (
              <ul key={i} className="list-disc space-y-sp1 pl-sp5 text-body text-muted">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          }
          if (block.type === "note") {
            return (
              <p
                key={i}
                className="rounded-btn border border-line bg-surface px-sp3 py-sp2 text-aux text-muted"
              >
                {block.text}
              </p>
            );
          }
          return (
            <p key={i} className="text-body text-muted">
              {block.text}
            </p>
          );
        })}
      </div>

      <p className="mt-sp6 text-aux text-muted">Last updated {doc.updatedAt}</p>
    </article>
  );
}
