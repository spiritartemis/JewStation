/**
 * Cookie 同意与匿名访客（0.5.0 / m-1d 1.0-01 ~ 1.0-03）
 *
 * 这个文件是**纯前端/服务端通用**的部分：只有常量、类型和序列化，不碰网络也不碰 Node API。
 * 真正的库操作在 `privacy-server.ts`，两类文件分开是为了不让客户端组件拉进服务端依赖。
 *
 * 三条口径（对应 docs/gd-m1d-bootstrap.md）：
 * 1. **先同意后追踪**（B-4.1）：`personalisation` 为 false 时，前端不上报浏览、服务端不收；
 * 2. **拒绝也照常用**（B-4.2）：同意状态只影响个性化，浏览 / 筛选 / 购物袋 / 结账一律不受影响；
 * 3. **随时能撤回**（B-4.3）：撤回即停止采集，并删除服务端已采集的浏览记录。
 */

/** 记录用户选择的 cookie（必要 cookie，本身不用于追踪） */
export const CONSENT_COOKIE = "mm_consent";
/** 匿名访客 ID：HttpOnly，服务端下发，前端脚本读不到 */
export const VISITOR_COOKIE = "mm_vid";
/**
 * 政策版本：隐私 / Cookie 文本内容实质变更时才改。
 * 同意记录里存这个值，才能说清用户当初同意的是哪一版。
 */
export const POLICY_VERSION = "2026-11-10";
/** 保留期（2026-11-10 站长定）：访客 ID 与浏览记录 180 天 */
export const RETENTION_DAYS = 180;

/**
 * 同意范围。`necessary` 恒为 true 且不可关闭——购物袋、币种、语言、
 * sharecode 这些都靠它，关掉站点就不是「少个推荐位」而是直接不能用。
 */
export type ConsentScope = {
  necessary: true;
  personalisation: boolean;
};

export const DEFAULT_SCOPE: ConsentScope = { necessary: true, personalisation: false };

/** 解析 cookie 值；任何脏数据都当「还没选过」处理，宁可再问一次也不要猜用户的意思 */
export function parseConsent(raw: string | null | undefined): ConsentScope | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw)) as Partial<ConsentScope> & { v?: number };
    // 版本号对不上（比如以后改了结构）就重新问，不沿用旧值
    if (!v || v.v !== 1) return null;
    return { necessary: true, personalisation: v.personalisation === true };
  } catch {
    return null;
  }
}

/** 序列化成 cookie 值 */
export function serializeConsent(scope: ConsentScope): string {
  return encodeURIComponent(JSON.stringify({ v: 1, personalisation: scope.personalisation === true }));
}

/** 32 位小写十六进制：与服务端函数 `^[0-9a-f]{32}$` 的校验保持一致 */
export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

/** cookie 有效期：与保留期同口径，到期浏览器自己丢掉 */
export function consentCookieMaxAge(): number {
  return RETENTION_DAYS * 24 * 60 * 60;
}
