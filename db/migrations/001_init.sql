-- =============================================================================
-- Morrow & Muse · 数据库初始化迁移 001
-- -----------------------------------------------------------------------------
-- 来源：2026-11-07 从线上 WorkBuddy 云数据库（应用 wbapp_EhTJKKsQkbleBP7uueKtfy）
--       导出的真实结构，按可重建 / 可重复执行的形式整理。
-- 对应站点版本：0.4.1 建表 → 0.4.6 订单终态保护 → 0.4.7（本文件已含最新函数定义）
--
-- 执行顺序：
--   新库（空库）：只执行 001_init.sql 即可，里面已经是带终态保护的最新函数。
--   从 0.4.1 的旧库升级：再执行 002_order_status_guard.sql（与 001 中该函数等价，
--   重复执行无副作用）。
--
-- 幂等性：建表用 IF NOT EXISTS、函数用 CREATE OR REPLACE、授权用动态判断，
--         整份脚本可重复执行。
--
-- ⚠️ 本文件只作为版本化记录，**未在现有生产库上执行过**。首次在真实环境重建时，
--    建议先在空库 / 测试库跑一遍，再核对下面的权限说明。
--
-- 安全模型（重要）：
--   4 张表全部 ENABLE ROW LEVEL SECURITY 且**不创建任何 policy**，
--   默认拒绝一切直读直写；客户端只能调用 SECURITY DEFINER 函数，
--   由函数在内部校验 accessToken 后以 owner 身份读写。
--   线上 ACL 里 anon 还保留着表的 SELECT 权限（被 RLS 挡成 0 行），
--   本脚本改为显式 REVOKE，行为等价但权限更收敛。
--
-- 库存初始化：不需要 INSERT 种子数据。jew_reserve_stock 接受 items[].seed，
--   首次出现某 slug 时按商品目录基准补种（见 src/lib/store/postgres.ts）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.jew_stock (
  slug        text PRIMARY KEY,
  stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jew_orders (
  id            text PRIMARY KEY,
  access_token  text NOT NULL,
  status        text NOT NULL,
  ship_to       jsonb NOT NULL,
  lines         jsonb NOT NULL,
  subtotal_usd  numeric NOT NULL,
  shipping_usd  numeric NOT NULL,
  total_usd     numeric NOT NULL,
  tax_included  boolean NOT NULL DEFAULT true,
  duty_paid     boolean NOT NULL DEFAULT true,
  payment       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jew_payment_keys (
  pay_key     text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jew_mail_outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  html        text NOT NULL,
  body_text   text NOT NULL,
  kind        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 无 policy 的 RLS = 默认拒绝。不要在这里补任何 USING / WITH CHECK。
ALTER TABLE public.jew_stock        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jew_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jew_payment_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jew_mail_outbox  ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. 函数（全部与线上 pg_get_functiondef 一致）
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.jew_ping()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object('ok', true, 'at', now())
$function$;

CREATE OR REPLACE FUNCTION public.jew_read_stock(p_slugs text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_object_agg(slug, stock), '{}'::jsonb)
  FROM jew_stock WHERE slug = ANY(p_slugs)
$function$;

CREATE OR REPLACE FUNCTION public.jew_reserve_stock(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slugs text[];
  it record;
  cur int;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'slug', '', 'reason', 'empty');
  END IF;

  SELECT array_agg(DISTINCT e->>'slug') INTO v_slugs
  FROM jsonb_array_elements(p_items) e;

  -- 第一次出现的商品按目录基准补种；已存在的行不动（ON CONFLICT DO NOTHING）
  INSERT INTO jew_stock (slug, stock)
  SELECT e->>'slug', GREATEST(COALESCE((e->>'seed')::int, 0), 0)
  FROM jsonb_array_elements(p_items) e
  ON CONFLICT (slug) DO NOTHING;

  -- 先锁行再全量校验：两个访客同时抢最后一件孤品只能有一个成功
  PERFORM 1 FROM jew_stock WHERE slug = ANY (v_slugs) FOR UPDATE;

  FOR it IN
    SELECT e->>'slug' AS slug, (e->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) e
  LOOP
    IF it.qty IS NULL OR it.qty <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'slug', it.slug, 'reason', 'bad_qty');
    END IF;
    SELECT stock INTO cur FROM jew_stock WHERE slug = it.slug;
    IF cur IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'slug', it.slug, 'reason', 'unknown_product');
    END IF;
    IF cur < it.qty THEN
      RETURN jsonb_build_object('ok', false, 'slug', it.slug, 'reason', 'out_of_stock');
    END IF;
  END LOOP;

  UPDATE jew_stock s
  SET stock = s.stock - x.qty, updated_at = now()
  FROM (
    SELECT e->>'slug' AS slug, (e->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) e
  ) x
  WHERE s.slug = x.slug;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.jew_release_stock(p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RETURN; END IF;
  UPDATE jew_stock s
  SET stock = s.stock + x.qty, updated_at = now()
  FROM (
    SELECT e->>'slug' AS slug, (e->>'qty')::int AS qty
    FROM jsonb_array_elements(p_items) e
  ) x
  WHERE s.slug = x.slug;
END;
$function$;

CREATE OR REPLACE FUNCTION public.jew_put_order(p_order jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO jew_orders
    (id, access_token, status, ship_to, lines, subtotal_usd, shipping_usd,
     total_usd, tax_included, duty_paid, payment, created_at, updated_at)
  VALUES
    (p_order->>'id', p_order->>'accessToken', p_order->>'status',
     p_order->'shipTo', p_order->'lines',
     (p_order->>'subtotalUsd')::numeric, (p_order->>'shippingUsd')::numeric,
     (p_order->>'totalUsd')::numeric,
     COALESCE((p_order->>'taxIncluded')::boolean, true),
     COALESCE((p_order->>'dutyPaid')::boolean, true),
     p_order->'payment',
     COALESCE((p_order->>'createdAt')::timestamptz, now()),
     COALESCE((p_order->>'updatedAt')::timestamptz, now()))
  ON CONFLICT (id) DO UPDATE
    SET status = EXCLUDED.status,
        payment = EXCLUDED.payment,
        updated_at = EXCLUDED.updated_at;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.jew_get_order(p_id text, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb;
BEGIN
  -- 口令不对与订单不存在返回同一个 NULL，避免被拿来枚举订单号
  IF p_id IS NULL OR p_token IS NULL OR length(p_token) < 16 THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id', o.id,
    'accessToken', o.access_token,
    'status', o.status,
    'shipTo', o.ship_to,
    'lines', o.lines,
    'subtotalUsd', o.subtotal_usd::float8,
    'shippingUsd', o.shipping_usd::float8,
    'totalUsd', o.total_usd::float8,
    'taxIncluded', o.tax_included,
    'dutyPaid', o.duty_paid,
    'payment', o.payment,
    'createdAt', to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) INTO r
  FROM jew_orders o
  WHERE o.id = p_id AND o.access_token = p_token;
  RETURN r;
END;
$function$;

-- 0.4.6：带终态保护的当前线上定义（历史与增量见 002_order_status_guard.sql）
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

  SELECT o.status INTO v_current
  FROM jew_orders o
  WHERE o.id = p_id AND o.access_token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- 取消 / 退款时库存已回补，终态单绝不能复活成 paid
  IF v_current IN ('cancelled','refunded') THEN RETURN NULL; END IF;
  -- 已付款的单不能倒退回待付款
  IF v_current IN ('paid','fulfilled') AND p_status = 'created' THEN RETURN NULL; END IF;

  UPDATE jew_orders
  SET status = p_status, updated_at = now()
  WHERE id = p_id AND access_token = p_token;

  SELECT jew_get_order(p_id, p_token) INTO r;
  RETURN r;
END;
$function$;

-- 幂等键：首次调用返回 true，重复回调返回 false（不用「先查再写」）
CREATE OR REPLACE FUNCTION public.jew_claim_payment_key(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 THEN RETURN false; END IF;
  INSERT INTO jew_payment_keys (pay_key) VALUES (p_key)
  ON CONFLICT (pay_key) DO NOTHING;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.jew_append_outbox(p_entry jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO jew_mail_outbox (to_email, subject, html, body_text, kind)
  VALUES (
    p_entry->>'to',
    COALESCE(p_entry->>'subject', ''),
    COALESCE(p_entry->>'html', ''),
    COALESCE(p_entry->>'text', ''),
    COALESCE(p_entry->>'kind', 'generic')
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. 权限
--    role 名用 pg_roles 动态判断：不同环境的平台角色可能不存在，
--    写死 GRANT 会让整份迁移在别的库上直接失败。
-- -----------------------------------------------------------------------------

REVOKE ALL ON TABLE
  public.jew_stock, public.jew_orders,
  public.jew_payment_keys, public.jew_mail_outbox
FROM PUBLIC;

DO $$
DECLARE
  r text;
  sig text;
  sigs text[] := ARRAY[
    'public.jew_ping()',
    'public.jew_read_stock(text[])',
    'public.jew_reserve_stock(jsonb)',
    'public.jew_release_stock(jsonb)',
    'public.jew_put_order(jsonb)',
    'public.jew_get_order(text, text)',
    'public.jew_set_order_status(text, text, text)',
    'public.jew_claim_payment_key(text)',
    'public.jew_append_outbox(jsonb)'
  ];
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.jew_stock, public.jew_orders, '
        || 'public.jew_payment_keys, public.jew_mail_outbox FROM %I', r);
      FOREACH sig IN ARRAY sigs LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', sig, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. 自检（只读，可在测试库手工执行）
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname LIKE 'jew_%' ORDER BY proname;  -- 应为 9 行
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'jew_%'
--     AND relkind = 'r';  -- 4 行，relrowsecurity 全为 true
--   SELECT count(*) FROM pg_policy;  -- 本 schema 下应为 0，直读表必须被挡住
-- =============================================================================
