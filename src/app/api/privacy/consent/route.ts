import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import {
  CONSENT_COOKIE,
  VISITOR_COOKIE,
  consentCookieMaxAge,
  isVisitorId,
  serializeConsent,
  type ConsentScope,
} from "@/lib/privacy";
import { ensureVisitor, logConsent, type ConsentAction } from "@/lib/privacy-server";

/**
 * 同意状态的服务端落地（0.5.0 / 1.0-01）
 *
 * 前端把用户的选择写进 `mm_consent`（本地就能读，界面据此渲染），
 * 同时调这里把**服务端该做的事**做掉：分配匿名访客 ID、留一条同意记录、
 * 撤回时把已采集的浏览记录删掉。
 *
 * 三条分支，别混：
 *   · 接受个性化 → 建访客 + 记 grant + 下发 HttpOnly 的 mm_vid
 *   · 只要必要   → 不建访客；若本来有访客，等同于撤回（清记录 + 清 cookie）
 *   · 撤回       → 清记录 + 清 cookie
 *
 * 失败策略：云端不可用时返回 ok:false，但**不抛错**——前端照常把选择写进 cookie，
 * 只是个性化暂时不生效。宁可少一个推荐位，也不能让同意条把页面卡住。
 */

export const runtime = "nodejs";

type Body = {
  action?: unknown;
  personalisation?: unknown;
};

function isAction(v: unknown): v is ConsentAction {
  return v === "grant" || v === "update" || v === "revoke";
}

/**
 * 是否给 cookie 加 Secure。
 *
 * 按**实际请求协议**判断，而不是 `NODE_ENV`：本地用 `npm start` 跑的是 production 构建，
 * 但走的是 http://localhost —— 那种情况下 NODE_ENV 会说「线上」，浏览器却会因为
 * Secure 属性直接把 cookie 丢掉，表现为「点了接受但访客 ID 永远建不起来」。
 */
function wantsSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const action = body.action;
  if (!isAction(action)) {
    return NextResponse.json({ ok: false, code: "bad_action" }, { status: 400 });
  }

  const personalisation = body.personalisation === true;
  const scope: ConsentScope = { necessary: true, personalisation };

  const jar = await cookies();
  const existing = jar.get(VISITOR_COOKIE)?.value;
  const visitorId = isVisitorId(existing) ? existing : null;

  const res = NextResponse.json(
    { ok: true, personalisation },
    { headers: { "Cache-Control": "no-store" } },
  );

  // —— 情形一：接受个性化，且还没有访客 ID ——
  if (personalisation && (action === "grant" || action === "update")) {
    let id = visitorId;
    if (!id) {
      // 16 字节 → 32 位十六进制，与服务端函数的格式校验一致；不含任何设备信息
      id = randomBytes(16).toString("hex");
    }

    const created = await ensureVisitor(id);
    if (!created) {
      // 云端不可用：不发 cookie，前端仍记本地选择，下次进偏好面板可重试
      return NextResponse.json(
        { ok: false, code: "unavailable", personalisation },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const logged = await logConsent(id, scope, action);
    if (!logged.ok) {
      return NextResponse.json(
        { ok: false, code: "unavailable", personalisation },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    res.cookies.set({
      name: VISITOR_COOKIE,
      value: id,
      httpOnly: true,
      sameSite: "lax",
      secure: wantsSecure(req),
      path: "/",
      maxAge: consentCookieMaxAge(),
    });
    res.cookies.set({
      name: CONSENT_COOKIE,
      value: serializeConsent(scope),
      httpOnly: false,
      sameSite: "lax",
      secure: wantsSecure(req),
      path: "/",
      maxAge: consentCookieMaxAge(),
    });
    return res;
  }

  // —— 情形二：撤回，或改成「只要必要」 ——
  // 有访客 ID 就必须走一次 revoke：数据库在同一事务里删掉浏览记录，
  // 并把 revoked_at 打上，之后任何读函数都会返回空。
  if (visitorId) {
    await logConsent(visitorId, scope, "revoke");
    res.cookies.delete(VISITOR_COOKIE);
  }

  res.cookies.set({
    name: CONSENT_COOKIE,
    value: serializeConsent(scope),
    httpOnly: false,
    sameSite: "lax",
    secure: wantsSecure(req),
    path: "/",
    maxAge: consentCookieMaxAge(),
  });

  return res;
}
