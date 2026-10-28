import { DocView } from "@/components/content/DocView";
import { ABOUT } from "@/content/site-content";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "About",
  description: "Small-batch jewellery: hand-formed one-of-a-kind pieces and limited runs.",
  path: "/about",
});

export default function AboutPage() {
  return <DocView doc={ABOUT} />;
}
