/**
 * WorkBuddy 云服务连接配置（m-1c / 1c-2）
 *
 * 这两个值来自云服务开通时下发的 publicConfig，是**公开配置**，不是密钥：
 * `publishableKey` 只表明「是哪个应用」，真正的边界由服务端按 Origin + RLS 判定，
 * 所以它可以随代码走。真正的密钥（数据库连接串、Stripe secret）在服务端托管平台里，永不入仓。
 *
 * 为什么单独一个文件而不是直接用 NEXT_PUBLIC_SITE_URL：
 * 本地开发时站点地址是 localhost，而数据面固定在应用的发布域名上——两者不是一回事。
 * 需要换环境（比如另开一个应用做灰度）时，只改这里或注入环境变量。
 */
export const CLOUD = {
  endpoint:
    process.env.WORKBUDDY_CLOUD_ENDPOINT ?? "https://morrow-muse.app.workbuddy.host",
  publishableKey:
    process.env.WORKBUDDY_CLOUD_PUBLISHABLE_KEY ??
    "wbpk_EhTJKKsQkbleBP7uueKtfy_ZIh1T4PMb9AdNHttFYF0szz7VQZCshMy",
} as const;

/** 两个值都齐了才算「云端可用」；缺一个就退回内存模式并明确告知 */
export function cloudConfigured(): boolean {
  return Boolean(CLOUD.endpoint && CLOUD.publishableKey);
}
