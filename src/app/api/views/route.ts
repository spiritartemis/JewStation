import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { VISITOR_COOKIE, isVisitorId } from "@/lib/privacy";
import { recordView } from "@/lib/privacy-server";

/**
 * 商品浏览上报（0.5.0 / 1.0-03）
 *
 * 只有拿到 HttpOnly 的访客 cookie 才会写——而那个 cookie 只在用户明确接受个性化时
 * 才会下发（见 /api/privacy/consent）。所以「拒绝后不再采集」不靠前端自觉，
 * 而是这里根本没有身份可用。
 *
 * 一律返回 200：浏览上报失败不该在控制台里刷红，也不该影响用户看商品。
 * 真正的失败原因放在 body 的 reason 里，只给验收脚本和排查用。
 */

export const runtime = "nodejs";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function POST(req: Request) {
  let body: { slug?: unknown; tags?: unknown };
  try {
    body = (await req.json()) as { slug?: unknown; tags?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 200 });
  }

  const slug = typeof body.slug === "string" ? body.slug : "";
  if (!SLUG_RE.test(slug) || slug.length > 80) {
    return NextResponse.json({ ok: false, reason: "bad_slug" }, { status: 200 });
  }

  const jar = await cookies();
  const visitorId = jar.get(VISITOR_COOKIE)?.value;
  if (!isVisitorId(visitorId)) {
    return NextResponse.json({ ok: false, reason: "no_visitor" }, { status: 200 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string")
    : [];

  const res = await recordView(visitorId, slug, tags);
  return NextResponse.json(res, { status: 200, headers: { "Cache-Control": "no-store" } });
}
