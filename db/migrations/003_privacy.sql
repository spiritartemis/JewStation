-- =============================================================================
-- Morrow & Muse · 数据库迁移 003 · 隐私同意与匿名访客
-- -----------------------------------------------------------------------------
-- 对应站点版本：0.5.0（m-1d launch / 1.0-01 ~ 1.0-03）
-- 上游依据：docs/gd-m1d-bootstrap.md B-4.1 ~ B-4.5
--
-- 解决什么：
--   1. 非必要追踪必须**先取得同意**才能启动（B-4.1），所以要有一份同意记录；
--   2. 访客要能被识别回访，但不能是个人信息（B-4.4），所以只存随机 ID；
--   3. 浏览行为必须**服务端持久化**，不能只靠 localStorage（B-4.5）。
--
-- 安全模型（与 001 完全一致，别在这里开口子）：
--   三张表全部 ENABLE ROW LEVEL SECURITY 且**不创建任何 policy** → 默认拒绝直读直写；
--   对外只暴露 SECURITY DEFINER 函数，函数内部自己校验「有没有同意」「ID 合不合法」。
--
-- 保留期：180 天（2026-11-10 站长定）。每张表都带 expires_at，
--   `jew_purge_expired()` 负责真删；过期判断与删除是两件事：
--   读函数一律带 `expires_at > now()`，所以即使清理没跑，过期数据也读不出来。
--
-- 幂等性：建表 IF NOT EXISTS、索引 IF NOT EXISTS、函数 CREATE OR REPLACE、
--         授权动态判断角色是否存在。整份脚本可重复执行，**不在线上直接跑**。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

-- 匿名访客：只是「同一个浏览器回来过」的一个随机标记，不含 IP、邮箱、设备指纹。
CREATE TABLE IF NOT EXISTS public.jew_visitors (
  id             text PRIMARY KEY,
  -- {"necessary":true,"personalisation":true|false}；只记本次有效的选择，不记历史
  consent_scope  jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);

-- 浏览记录：只存商品 slug 与当时的标签快照，不存页面路径、不存搜索词。
-- 标签快照的作用是：商品改标签后，历史推荐仍按当初那件东西理解，而不是被改写。
CREATE TABLE IF NOT EXISTS public.jew_views (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id  text NOT NULL,
  slug        text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',
  viewed_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);

CREATE INDEX IF NOT EXISTS jew_views_visitor_time_idx
  ON public.jew_views (visitor_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS jew_views_expires_idx
  ON public.jew_views (expires_at);

-- 同意记录：只增不改，是「当时到底点了什么」的凭据。
-- policy_ver 记政策版本，文本改了才能说清用户当初同意的是哪一版。
CREATE TABLE IF NOT EXISTS public.jew_consents (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id  text NOT NULL,
  scope       jsonb NOT NULL,
  policy_ver  text NOT NULL,
  action      text NOT NULL CHECK (action IN ('grant', 'update', 'revoke')),
  at          timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);

CREATE INDEX IF NOT EXISTS jew_consents_visitor_idx
  ON public.jew_consents (visitor_id, at DESC);

-- 无 policy 的 RLS = 默认拒绝。不要在这里补任何 USING / WITH CHECK。
ALTER TABLE public.jew_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jew_views    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jew_consents ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. 函数
-- -----------------------------------------------------------------------------

-- 建或续期访客。ID 由前端生成（32 位十六进制随机数），服务端只认格式、不认来源。
-- 已撤回的访客不再复活：撤回后前端会换一个新 ID，历史数据随撤回一起删掉。
CREATE OR REPLACE FUNCTION public.jew_ensure_visitor(
  p_id text,
  p_ttl_days integer DEFAULT 180
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ttl int := GREATEST(LEAST(COALESCE(p_ttl_days, 180), 365), 1);
  v_exp timestamptz := now() + (v_ttl || ' days')::interval;
  v_revoked timestamptz;
BEGIN
  -- 只接受 32 位小写十六进制：既挡住脏数据，也避免把用户可控字符串写进主键
  IF p_id IS NULL OR p_id !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_id');
  END IF;

  INSERT INTO jew_visitors (id, expires_at)
  VALUES (p_id, v_exp)
  ON CONFLICT (id) DO UPDATE
    SET last_seen_at = now(),
        expires_at   = v_exp;

  SELECT revoked_at INTO v_revoked FROM jew_visitors WHERE id = p_id;

  RETURN jsonb_build_object(
    'ok', v_revoked IS NULL,
    'id', p_id,
    'revoked', v_revoked IS NOT NULL,
    'expiresAt', to_char(v_exp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$function$;

-- 记一次同意（grant / update / revoke），并同步访客当前的 scope。
-- 撤回时**同事务删除**已采集的浏览记录：用户点了撤回，不能还留着旧轨迹。
CREATE OR REPLACE FUNCTION public.jew_log_consent(
  p_id text,
  p_scope jsonb,
  p_policy_ver text,
  p_action text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted int := 0;
BEGIN
  IF p_id IS NULL OR p_id !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_id');
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('grant', 'update', 'revoke') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
  END IF;
  IF p_scope IS NULL OR jsonb_typeof(p_scope) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_scope');
  END IF;

  -- 访客不存在就顺手建一个，避免「先同意后建号」的顺序问题
  INSERT INTO jew_visitors (id) VALUES (p_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO jew_consents (visitor_id, scope, policy_ver, action)
  VALUES (p_id, p_scope, COALESCE(NULLIF(p_policy_ver, ''), 'v1'), p_action);

  UPDATE jew_visitors
  SET consent_scope = p_scope,
      consent_at    = now(),
      last_seen_at  = now(),
      revoked_at    = CASE WHEN p_action = 'revoke' THEN now() ELSE NULL END
  WHERE id = p_id;

  IF p_action = 'revoke' THEN
    DELETE FROM jew_views WHERE visitor_id = p_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'deletedViews', v_deleted);
END;
$function$;

-- 记一次浏览。没同意个性化 / 已撤回 / 访客过期，一律不写（返回 no_consent，不抛错）。
-- 每访客最多留 200 条，超出的按时间从旧到新删掉，避免表无限长。
CREATE OR REPLACE FUNCTION public.jew_record_view(
  p_id text,
  p_slug text,
  p_tags text[] DEFAULT '{}'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := NULLIF(BTRIM(COALESCE(p_slug, '')), '');
  v_allowed boolean;
  v_exp timestamptz;
  v_kept int;
BEGIN
  IF p_id IS NULL OR p_id !~ '^[0-9a-f]{32}$' OR v_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  -- slug 只可能是小写字母数字 + 连字符，别让任意字符串进表
  IF v_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(v_key) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_slug');
  END IF;

  SELECT (v.revoked_at IS NULL)
         AND COALESCE((v.consent_scope ->> 'personalisation')::boolean, false)
         AND v.expires_at > now()
    INTO v_allowed
  FROM jew_visitors v WHERE v.id = p_id;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_consent');
  END IF;

  v_exp := now() + interval '180 days';

  INSERT INTO jew_views (visitor_id, slug, tags, expires_at)
  VALUES (p_id, v_key, COALESCE(p_tags, '{}'), v_exp);

  -- 只保留最近 200 条
  DELETE FROM jew_views
  WHERE visitor_id = p_id
    AND id NOT IN (
      SELECT id FROM jew_views
      WHERE visitor_id = p_id
      ORDER BY viewed_at DESC
      LIMIT 200
    );

  SELECT count(*) INTO v_kept FROM jew_views WHERE visitor_id = p_id;
  RETURN jsonb_build_object('ok', true, 'kept', v_kept);
END;
$function$;

-- 取最近浏览（0.6.0 的标签推荐要用；0.5.0 只用于自测与验收取证）。
-- 同样要求当前仍处于「已同意个性化」状态，撤回后立刻查不到东西。
CREATE OR REPLACE FUNCTION public.jew_recent_views(
  p_id text,
  p_limit integer DEFAULT 20
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lim int := GREATEST(LEAST(COALESCE(p_limit, 20), 100), 1);
  v_allowed boolean;
  r jsonb;
BEGIN
  IF p_id IS NULL OR p_id !~ '^[0-9a-f]{32}$' THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT (v.revoked_at IS NULL)
         AND COALESCE((v.consent_scope ->> 'personalisation')::boolean, false)
         AND v.expires_at > now()
    INTO v_allowed
  FROM jew_visitors v WHERE v.id = p_id;

  IF NOT COALESCE(v_allowed, false) THEN RETURN '[]'::jsonb; END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'viewedAt' DESC), '[]'::jsonb) INTO r
  FROM (
    SELECT jsonb_build_object(
             'slug', w.slug,
             'tags', to_jsonb(w.tags),
             'viewedAt', to_char(w.viewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ) AS x
    FROM jew_views w
    WHERE w.visitor_id = p_id AND w.expires_at > now()
    ORDER BY w.viewed_at DESC
    LIMIT v_lim
  ) t;

  RETURN r;
END;
$function$;

-- 清理过期数据。设计上由定时任务调用；就算一直没跑，读函数也带 expires_at 过滤，
-- 不会把过期数据当有效数据返回。
CREATE OR REPLACE FUNCTION public.jew_purge_expired()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_views int := 0;
  v_consents int := 0;
  v_visitors int := 0;
BEGIN
  DELETE FROM jew_views WHERE expires_at <= now();
  GET DIAGNOSTICS v_views = ROW_COUNT;

  DELETE FROM jew_consents WHERE expires_at <= now();
  GET DIAGNOSTICS v_consents = ROW_COUNT;

  -- 访客行最后删：它过期了，其浏览与同意记录也没有保留意义
  DELETE FROM jew_visitors WHERE expires_at <= now();
  GET DIAGNOSTICS v_visitors = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'views', v_views,
    'consents', v_consents,
    'visitors', v_visitors
  );
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. 权限（与 001 同口径：先 REVOKE 表，再按角色存在性 GRANT 函数）
-- -----------------------------------------------------------------------------

REVOKE ALL ON TABLE
  public.jew_visitors, public.jew_views, public.jew_consents
FROM PUBLIC;

DO $$
DECLARE
  r text;
  sig text;
  sigs text[] := ARRAY[
    'public.jew_ensure_visitor(text, integer)',
    'public.jew_log_consent(text, jsonb, text, text)',
    'public.jew_record_view(text, text, text[])',
    'public.jew_recent_views(text, integer)',
    'public.jew_purge_expired()'
  ];
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE public.jew_visitors, public.jew_views, '
        || 'public.jew_consents FROM %I', r);
      FOREACH sig IN ARRAY sigs LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', sig, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. 自检（只读，可在测试库手工执行）
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname LIKE 'jew_%' ORDER BY proname;  -- 应为 14 行
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'jew_%'
--     AND relkind = 'r';  -- 7 行，relrowsecurity 全为 true
--   SELECT count(*) FROM pg_policy;  -- 本 schema 下应为 0
--
-- 功能自测（测试库）：
--   SELECT jew_ensure_visitor(repeat('a', 32));                       -- ok
--   SELECT jew_log_consent(repeat('a',32), '{"personalisation":true}', 'v1', 'grant');
--   SELECT jew_record_view(repeat('a',32), 'silver-wave-hoops', ARRAY['earrings']);
--   SELECT jew_recent_views(repeat('a',32), 5);                       -- 1 条
--   SELECT jew_log_consent(repeat('a',32), '{"personalisation":false}', 'v1', 'revoke');
--   SELECT jew_recent_views(repeat('a',32), 5);                       -- 撤回后应为 []
-- =============================================================================
