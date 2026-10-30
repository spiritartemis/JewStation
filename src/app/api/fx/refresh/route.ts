import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

/**
 * 汇率日切（Q-05：每天 0 点刷新一次）
 *
 * 页面本身按「距下一个北京时间 0 点的秒数」缓存（见 lib/currency.ts），
 * 这个端点只负责**在 0 点后主动把缓存踢掉**，避免第一个访客替所有人承担回源延迟。
 * 部署侧用一条定时任务在 00:00（Asia/Shanghai）打一次即可：
 *
 *   curl -X POST "https://<域名>/api/fx/refresh?token=$FX_REFRESH_TOKEN"
 *
 * 没配 FX_REFRESH_TOKEN 时直接 503 —— 宁可不可用，也不留一个无鉴权的公开重算入口。
 */
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const expected = process.env.FX_REFRESH_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "FX_REFRESH_TOKEN is not configured" },
      { status: 503 },
    );
  }

  const token = new URL(request.url).searchParams.get("token");
  if (token !== expected) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  revalidateTag("fx-usd-cny");
  revalidatePath("/", "layout");

  return NextResponse.json({ ok: true, refreshedAt: new Date().toISOString() });
}

export const GET = handle;
export const POST = handle;
