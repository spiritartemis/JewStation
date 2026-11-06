/**
 * 订单与库存存储的抽象层（m-1c / 1c-2）
 *
 * 为什么要有这一层：订单与库存必须落服务端，且扣减要**原子**——
 * 两个访客同时买最后一件孤品，只能有一个成功（04 §库存事件表）。
 * 页面与 API 只依赖这里的接口，换实现（Upstash / 内存 / 未来 Postgres）不用改业务代码。
 */

export type OrderStatus = "created" | "paid" | "fulfilled" | "cancelled" | "refunded";

/** 下单时冻结的商品快照：之后商品改价、下架都不能影响历史订单 */
export type OrderLine = {
  slug: string;
  title: string;
  priceUsd: number;
  qty: number;
  options: { name: string; value: string }[];
  oneOfAKind: boolean;
  imageUrl: string | null;
};

export type ShipTo = {
  name: string;
  email: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  country: "US" | "CN";
  phone?: string;
};

export type OrderPayment = {
  provider: "mock" | "stripe" | "paypal";
  /** 支付商侧单号；mock 实现里是自己生成的 */
  reference: string;
  /** 幂等键：同一笔支付回调重复到达时只生效一次 */
  idempotencyKey: string;
  paidAt?: string;
};

export type Order = {
  id: string;
  /** 查看订单所需的口令（放在确认页链接里），与邮箱一起构成两种访问路径 */
  accessToken: string;
  status: OrderStatus;
  shipTo: ShipTo;
  lines: OrderLine[];
  subtotalUsd: number;
  shippingUsd: number;
  totalUsd: number;
  /** 下单时的口径快照：含税 / DDP，之后规则改了也不改历史单 */
  taxIncluded: boolean;
  dutyPaid: boolean;
  createdAt: string;
  updatedAt: string;
  payment: OrderPayment;
};

export type ReserveItem = { slug: string; qty: number };

export type ReserveResult =
  | { ok: true }
  /** 明确告诉前端是哪一件不够：笼统的「下单失败」用户没法处理 */
  | { ok: false; slug: string; reason: "out_of_stock" | "unknown_product" };

export type StockSnapshot = Record<string, number>;

export interface Store {
  /** 原子预占：要么全部扣减成功，要么一件都不动 */
  reserveStock(items: ReserveItem[]): Promise<ReserveResult>;
  /** 回补（取消/退款）：幂等由调用方保证不重复调用 */
  releaseStock(items: ReserveItem[]): Promise<void>;
  /** 当前库存快照，用于下单前校验与后台查看 */
  readStock(slugs: string[]): Promise<StockSnapshot>;

  putOrder(order: Order): Promise<void>;

  /**
   * 读订单：**必须同时给出 accessToken**。
   *
   * 订单号只有 6 位（MM-XXXXXX），本身是可枚举的；口令是 128 位随机串，
   * 两者凑齐才算「持有者」。云端实现把校验下推到数据库函数里做，
   * 表本身对 anon 完全不可读，所以口令错与订单不存在返回同一个 null——
   * 调用方也就无法（也不需要）再区分这两种情况。
   */
  getOrder(id: string, token: string): Promise<Order | null>;

  /** 改状态同样要口令，否则任何知道订单号的人都能把单子标成已付款 */
  updateOrderStatus(id: string, status: OrderStatus, token: string): Promise<Order | null>;

  /**
   * 支付回调幂等：首次调用返回 true，重复调用返回 false。
   * 不用「先查再写」——那是两次往返，中间可能被并发插进来。
   */
  claimPaymentKey(key: string): Promise<boolean>;

  /** 邮件 outbox：没有接邮件服务商时先入库，接上后批量补发 */
  appendOutbox(entry: { to: string; subject: string; html: string; text: string; kind: string }): Promise<void>;
}
