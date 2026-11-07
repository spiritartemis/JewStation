-- =============================================================================
-- Morrow & Muse · 增量迁移 002：订单状态机终态保护
-- -----------------------------------------------------------------------------
-- 站点版本：0.4.6（2026-11-06 21:37 发布时同步改过线上数据库函数）
-- 本文件把那次直接在线上执行的 DDL 补进版本库，避免「重建数据库时漏掉约束」。
--
-- 修的是什么问题：
--   0.4.6 之前，jew_set_order_status 只校验目标状态是否合法，不校验流转方向。
--   于是同一笔单先点「取消」→ status = cancelled 且库存已回补，
--   再点「模拟支付成功」→ 会被改成 paid，
--   得到一笔「付了款却没占库存」的订单。
--   应用层 /api/pay/mock 后来也加了 409 order_closed 守卫，
--   但数据库层必须自己守住这条约束，否则任何能直接 rpc 的调用都能绕过。
--
-- 什么时候执行：
--   · 从 0.4.1 的旧库升级 → 执行本文件（幂等，可重复跑）。
--   · 用 001_init.sql 建的新库 → 001 里已经是这个最新定义，
--     不需要再执行；执行也无害（CREATE OR REPLACE 保留原有 GRANT）。
--
-- 规则：
--   created   → paid / cancelled（正常路径）
--   paid      → fulfilled / refunded / cancelled（不得倒退回 created）
--   fulfilled → refunded
--   cancelled / refunded → 终态，任何目标状态都返回 NULL
--   口令不对 / 订单不存在 → NULL（与「被守卫拒绝」返回同一个值，不泄露订单是否存在）
-- =============================================================================

CREATE OR REPLACE FUNCTION public.jew_set_order_status(p_id text, p_token text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb;
  v_current text;
BEGIN
  IF p_status NOT IN ('created','paid','fulfilled','cancelled','refunded') THEN
    RAISE EXCEPTION 'bad_status';
  END IF;

  -- 先读当前状态：WHERE 里带 access_token，口令不对与订单不存在都走 NOT FOUND
  SELECT o.status INTO v_current
  FROM jew_orders o
  WHERE o.id = p_id AND o.access_token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_current IN ('cancelled','refunded') THEN RETURN NULL; END IF;
  IF v_current IN ('paid','fulfilled') AND p_status = 'created' THEN RETURN NULL; END IF;

  UPDATE jew_orders
  SET status = p_status, updated_at = now()
  WHERE id = p_id AND access_token = p_token;

  SELECT jew_get_order(p_id, p_token) INTO r;
  RETURN r;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 自检（只在测试库跑；不要在含真实订单的生产库上造数据做这个验证）
--   1) 造一笔 created 单，调用 jew_set_order_status(id, token, 'cancelled')
--      → 返回订单 jsonb，状态 cancelled
--   2) 再调用 jew_set_order_status(id, token, 'paid')
--      → 返回 NULL，且查询状态仍为 cancelled
--   3) 用错 token 调用 → 返回 NULL
--   4) SELECT prosecdef FROM pg_proc WHERE proname = 'jew_set_order_status';
--      → true（SECURITY DEFINER 不能丢）
-- =============================================================================
