import { notFound } from "next/navigation";
import { DocView } from "@/components/content/DocView";
import { POLICIES } from "@/content/site-content";
import { buildMetadata } from "@/lib/seo";

/** 政策页：固定路径、文案来自内容源，未审核前明确标注（01 §4 / B-2.8） */
export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = POLICIES.find((p) => p.slug === slug);
  if (!doc) notFound();

  return <DocView doc={doc} />;
}

/** 描述取正文首段，保证每页 description 描述的是这页的真实内容（不是关键词堆） */
function descriptionOf(blocks: readonly { type: string; text?: string }[]): string {
  const first = blocks.find((b) => b.type === "p" && b.text);
  return first?.text ? first.text.slice(0, 140) : "";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = POLICIES.find((p) => p.slug === slug);
  if (!doc) return { title: "Policy not found" };

  // 原先只给 title，缺 canonical/OG；政策页同样需要规范 URL 与分享预览（B-2.9）
  return buildMetadata({
    title: doc.title,
    description: descriptionOf(doc.blocks) || doc.title,
    path: `/policies/${doc.slug}`,
  });
}

export function generateStaticParams() {
  return POLICIES.map((p) => ({ slug: p.slug }));
}
