import { notFound } from "next/navigation";
import { DocView } from "@/components/content/DocView";
import { POLICIES } from "@/content/site-content";

/** 政策页：固定路径、文案来自内容源，未审核前明确标注（01 §4 / B-2.8） */
export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = POLICIES.find((p) => p.slug === slug);
  if (!doc) notFound();

  return <DocView doc={doc} />;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: POLICIES.find((p) => p.slug === slug)?.title ?? "Policy" };
}

export function generateStaticParams() {
  return POLICIES.map((p) => ({ slug: p.slug }));
}
