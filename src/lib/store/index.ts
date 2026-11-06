import { cloudConfigured } from "@/lib/cloud";
import { memoryStore } from "./memory";
import { cloudStore } from "./postgres";
import { upstashStore } from "./upstash";
import type { Store } from "./types";

/**
 * 存储入口（m-1c / 1c-2）
 *
 * 三档，按「数据能不能在重新部署后活下来」排序：
 * 1. `cloud` — WorkBuddy 云数据库（Postgres）。订单与库存都落库，多实例并发安全。
 * 2. `upstash` — Redis，仅在显式配了一对凭证时启用（备用路线，不是当前默认）。
 * 3. `memory` — 进程内存。**重新部署就清空**，只用于本地开发；
 *    线上若落到这一档，页面会明确标注，不假装它是真实库存。
 *
 * 判断顺序不能反：云端没配时才该退到 Redis，否则配了云还在写 Redis 就是数据分叉。
 */
export type StoreMode = "cloud" | "upstash" | "memory";

export function storeMode(): StoreMode {
  if (cloudConfigured()) return "cloud";
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  return "memory";
}

export function getStore(): Store {
  switch (storeMode()) {
    case "cloud":
      return cloudStore;
    case "upstash":
      return upstashStore;
    default:
      return memoryStore;
  }
}

/** 仅内存模式需要在界面上说明「这是演示，重启即丢」 */
export function isEphemeralStore(): boolean {
  return storeMode() === "memory";
}

export * from "./types";
