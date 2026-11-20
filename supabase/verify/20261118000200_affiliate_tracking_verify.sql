-- ============================================================================
-- Verification for migration 20261118000200_affiliate_tracking
-- Read-only. No writes, no DDL.
--
-- Run this AFTER every earlier migration and 20261118000200_affiliate_tracking.sql
-- have been applied to the same project. Every statement returns a check_name and
-- a boolean passed. The migration is only considered applied when every `passed`
-- is true.
--
-- The behaviour (link limits, alias rules, the invite lifecycle, the click
-- uniqueness window, attribution, the rollup, the anomaly scan and the purge) is
-- covered by supabase/tests/affiliate_tracking_test.sh, which needs a throwaway
-- database.
-- ============================================================================

-- 1. The migration is recorded.
SELECT
  'migration_recorded' AS check_name,
  EXISTS (
    SELECT 1 FROM public.app_migrations
    WHERE version = '20261118000200' AND name = 'affiliate_tracking'
  ) AS passed;

-- 2. The six tables exist.
SELECT
  'tables_exist' AS check_name,
  (
    SELECT count(*) = 6
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'affiliate_product_access',
        'affiliate_invites',
        'affiliate_links',
        'affiliate_clicks',
        'affiliate_daily_stats',
        'risk_flags'
      )
  ) AS passed;

-- 3. Row level security is on for every one of them.
SELECT
  'rls_enabled' AS check_name,
  (
    SELECT count(*) = 6
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'affiliate_product_access',
        'affiliate_invites',
        'affiliate_links',
        'affiliate_clicks',
        'affiliate_daily_stats',
        'risk_flags'
      )
      AND c.relrowsecurity
  ) AS passed;

-- 4. anon has no privilege on any of them.
SELECT
  'anon_has_no_access' AS check_name,
  (
    SELECT count(*) = 0
    FROM (VALUES
      ('affiliate_product_access'),
      ('affiliate_invites'),
      ('affiliate_links'),
      ('affiliate_clicks'),
      ('affiliate_daily_stats'),
      ('risk_flags')
    ) AS t(name)
    WHERE has_table_privilege('anon', 'public.' || t.name, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t.name, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t.name, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t.name, 'DELETE')
  ) AS passed;

-- 5. affiliate_clicks is service-role only: no signed-in person can read it.
SELECT
  'clicks_have_no_client_access' AS check_name,
  NOT has_table_privilege('authenticated', 'public.affiliate_clicks', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_clicks', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_clicks', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_clicks', 'DELETE')
  AS passed;

-- 6. No client can write to any table here: every policy is SELECT only.
SELECT
  'no_client_writes' AS check_name,
  (
    SELECT count(*) = 0
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'affiliate_product_access',
        'affiliate_invites',
        'affiliate_links',
        'affiliate_clicks',
        'affiliate_daily_stats',
        'risk_flags'
      )
      AND cmd <> 'SELECT'
  )
  AND NOT has_table_privilege('authenticated', 'public.affiliate_links', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_links', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_links', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_product_access', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_product_access', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_product_access', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_invites', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_invites', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_invites', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_daily_stats', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_daily_stats', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.affiliate_daily_stats', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.risk_flags', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.risk_flags', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.risk_flags', 'DELETE')
  AS passed;

-- 7. Every function exists with the agreed signature.
WITH expected(name, args) AS (
  VALUES
    ('affiliate_can_promote', 'p_affiliate uuid, p_product uuid'),
    ('create_affiliate_link', 'p_affiliate uuid, p_product uuid, p_label text, p_alias text'),
    ('archive_affiliate_link', 'p_affiliate uuid, p_link uuid'),
    ('request_product_access', 'p_affiliate uuid, p_product uuid, p_note text'),
    ('decide_product_access', 'p_actor uuid, p_affiliate uuid, p_product uuid, p_decision text, p_note text'),
    ('create_affiliate_invite', 'p_actor uuid, p_product uuid, p_token_hash text, p_max_uses integer, p_expires_days integer'),
    ('accept_affiliate_invite', 'p_affiliate uuid, p_token_hash text'),
    ('get_link_target', 'p_code text'),
    ('record_click', 'p_click uuid, p_code text, p_ip_hash text, p_ua_hash text, p_referrer_host text, p_country text, p_device text, p_sub1 text, p_sub2 text, p_sub3 text, p_utm_source text, p_utm_medium text, p_utm_campaign text'),
    ('get_click_attribution', 'p_click uuid, p_product uuid'),
    ('rollup_affiliate_stats', 'p_from date, p_to date'),
    ('scan_click_anomalies', ''),
    ('purge_old_clicks', 'p_months integer')
)
SELECT
  'functions_exist' AS check_name,
  count(*) = 13 AS passed
FROM expected e
WHERE EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = e.name
    AND pg_get_function_identity_arguments(p.oid) = e.args
);

-- 8. Every one of them is SECURITY DEFINER with a pinned search_path.
WITH expected(name, args) AS (
  VALUES
    ('affiliate_can_promote', 'p_affiliate uuid, p_product uuid'),
    ('create_affiliate_link', 'p_affiliate uuid, p_product uuid, p_label text, p_alias text'),
    ('archive_affiliate_link', 'p_affiliate uuid, p_link uuid'),
    ('request_product_access', 'p_affiliate uuid, p_product uuid, p_note text'),
    ('decide_product_access', 'p_actor uuid, p_affiliate uuid, p_product uuid, p_decision text, p_note text'),
    ('create_affiliate_invite', 'p_actor uuid, p_product uuid, p_token_hash text, p_max_uses integer, p_expires_days integer'),
    ('accept_affiliate_invite', 'p_affiliate uuid, p_token_hash text'),
    ('get_link_target', 'p_code text'),
    ('record_click', 'p_click uuid, p_code text, p_ip_hash text, p_ua_hash text, p_referrer_host text, p_country text, p_device text, p_sub1 text, p_sub2 text, p_sub3 text, p_utm_source text, p_utm_medium text, p_utm_campaign text'),
    ('get_click_attribution', 'p_click uuid, p_product uuid'),
    ('rollup_affiliate_stats', 'p_from date, p_to date'),
    ('scan_click_anomalies', ''),
    ('purge_old_clicks', 'p_months integer')
)
SELECT
  'functions_hardened' AS check_name,
  count(*) = 13 AS passed
FROM expected e
WHERE EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = e.name
    AND pg_get_function_identity_arguments(p.oid) = e.args
    AND p.prosecdef
    AND p.proconfig::text LIKE '%search_path=%'
);

-- 9. No browser role may execute any of them, and neither may PUBLIC.
WITH expected(name, args) AS (
  VALUES
    ('affiliate_can_promote', 'p_affiliate uuid, p_product uuid'),
    ('create_affiliate_link', 'p_affiliate uuid, p_product uuid, p_label text, p_alias text'),
    ('archive_affiliate_link', 'p_affiliate uuid, p_link uuid'),
    ('request_product_access', 'p_affiliate uuid, p_product uuid, p_note text'),
    ('decide_product_access', 'p_actor uuid, p_affiliate uuid, p_product uuid, p_decision text, p_note text'),
    ('create_affiliate_invite', 'p_actor uuid, p_product uuid, p_token_hash text, p_max_uses integer, p_expires_days integer'),
    ('accept_affiliate_invite', 'p_affiliate uuid, p_token_hash text'),
    ('get_link_target', 'p_code text'),
    ('record_click', 'p_click uuid, p_code text, p_ip_hash text, p_ua_hash text, p_referrer_host text, p_country text, p_device text, p_sub1 text, p_sub2 text, p_sub3 text, p_utm_source text, p_utm_medium text, p_utm_campaign text'),
    ('get_click_attribution', 'p_click uuid, p_product uuid'),
    ('rollup_affiliate_stats', 'p_from date, p_to date'),
    ('scan_click_anomalies', ''),
    ('purge_old_clicks', 'p_months integer')
)
SELECT
  'clients_cannot_execute' AS check_name,
  count(*) = 0 AS passed
FROM expected e
JOIN pg_proc p ON p.proname = e.name
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
WHERE n.nspname = 'public'
  AND pg_get_function_identity_arguments(p.oid) = e.args
  AND (
    has_function_privilege(r.role_name, p.oid, 'EXECUTE')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    )
  );

-- 10. service_role may execute every one of them.
WITH expected(name, args) AS (
  VALUES
    ('affiliate_can_promote', 'p_affiliate uuid, p_product uuid'),
    ('create_affiliate_link', 'p_affiliate uuid, p_product uuid, p_label text, p_alias text'),
    ('archive_affiliate_link', 'p_affiliate uuid, p_link uuid'),
    ('request_product_access', 'p_affiliate uuid, p_product uuid, p_note text'),
    ('decide_product_access', 'p_actor uuid, p_affiliate uuid, p_product uuid, p_decision text, p_note text'),
    ('create_affiliate_invite', 'p_actor uuid, p_product uuid, p_token_hash text, p_max_uses integer, p_expires_days integer'),
    ('accept_affiliate_invite', 'p_affiliate uuid, p_token_hash text'),
    ('get_link_target', 'p_code text'),
    ('record_click', 'p_click uuid, p_code text, p_ip_hash text, p_ua_hash text, p_referrer_host text, p_country text, p_device text, p_sub1 text, p_sub2 text, p_sub3 text, p_utm_source text, p_utm_medium text, p_utm_campaign text'),
    ('get_click_attribution', 'p_click uuid, p_product uuid'),
    ('rollup_affiliate_stats', 'p_from date, p_to date'),
    ('scan_click_anomalies', ''),
    ('purge_old_clicks', 'p_months integer')
)
SELECT
  'service_role_access' AS check_name,
  count(*) = 13 AS passed
FROM expected e
WHERE EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = e.name
    AND pg_get_function_identity_arguments(p.oid) = e.args
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
);

-- 11. create_order kept its signature and now asks affiliate_can_promote.
SELECT
  'create_order_replaced' AS check_name,
  (
    SELECT count(*) = 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_order'
      AND pg_get_function_identity_arguments(p.oid)
          = 'p_buyer_user uuid, p_email text, p_name text, p_product uuid, p_affiliate uuid, p_click uuid, p_ip_hash text, p_reference text'
      AND p.prosrc LIKE '%affiliate_can_promote%'
      AND p.prosrc LIKE '%affiliate_approval = ''open''%' = false
  ) AS passed;

-- 12. The statistics upsert has one conflict target: the sentinel index.
SELECT
  'stats_unique_key' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'affiliate_daily_stats_key_idx'
      AND i.indisunique
      AND pg_get_indexdef(i.indexrelid) LIKE '%COALESCE(link_id%00000000-0000-0000-0000-000000000000%'
  ) AS passed;

-- 13. A link code is unique, and the code pattern is enforced by a CHECK.
SELECT
  'link_code_rules' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    WHERE t.relname = 'affiliate_links' AND c.relname = 'affiliate_links_code_key' AND i.indisunique
  )
  AND EXISTS (
    SELECT 1
    FROM pg_constraint k
    JOIN pg_class t ON t.oid = k.conrelid
    WHERE t.relname = 'affiliate_links'
      AND k.contype = 'c'
      AND pg_get_constraintdef(k.oid) LIKE '%a-hj-km-np-z2-9%'
  ) AS passed;

-- 14. A click stores hashes and a host, never an address or a full referrer.
SELECT
  'click_columns_are_safe' AS check_name,
  (
    SELECT count(*) = 0
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'affiliate_clicks'
      AND column_name IN ('ip', 'ip_address', 'user_agent', 'ua', 'referrer', 'referer', 'email')
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_clicks' AND column_name = 'ip_hash'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'affiliate_clicks' AND column_name = 'ua_hash'
  )
  AS passed;

-- 15. The policy set is exactly what was described: an affiliate reads their
-- own rows, a vendor reads the rows for their products, and admin and moderator
-- read everything. Risk flags are admin and moderator only.
SELECT
  'policies_in_place' AS check_name,
  (
    SELECT count(*) = 10
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'affiliate_product_access',
        'affiliate_invites',
        'affiliate_links',
        'affiliate_daily_stats',
        'risk_flags'
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'affiliate_clicks'
  )
  AND EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'risk_flags'
      AND policyname = 'risk_flags_select_staff'
      AND qual LIKE '%admin%'
      AND qual LIKE '%moderator%'
  ) AS passed;
