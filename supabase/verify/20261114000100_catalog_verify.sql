-- ============================================================================
-- Verification for migration 20261114000100_catalog
-- Read-only. No writes, no DDL.
--
-- Run this AFTER 20261112000100_foundation.sql,
-- 20261113000100_roles_onboarding.sql and 20261114000100_catalog.sql have been
-- applied to the same project. Every statement returns a check_name and a
-- boolean passed.
-- The migration is only considered applied when every `passed` is true.
-- ============================================================================

-- 1. The four catalog tables exist in public.
SELECT
  'tables_exist' AS check_name,
  (
    SELECT count(*) = 4
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ('product_categories', 'products', 'product_files', 'product_images')
  ) AS passed;

-- 2. The three settings the rules read, at their seeded values.
SELECT
  'settings_seeded' AS check_name,
  (
    SELECT count(*) = 3
    FROM public.settings
    WHERE (key = 'refund_window_min_hours'    AND value = '24'::jsonb)
       OR (key = 'product_commission_min_bps' AND value = '500'::jsonb)
       OR (key = 'product_commission_max_bps' AND value = '8000'::jsonb)
  ) AS passed;

-- 3. public.product_categories: exact shape, and the nine seeded rows.
SELECT
  'product_categories_columns' AS check_name,
  (
    SELECT count(*) = 4
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_categories'
      AND (
        (column_name = 'id'   AND data_type = 'smallint' AND is_nullable = 'NO')
        OR (column_name = 'slug' AND data_type = 'USER-DEFINED' AND is_nullable = 'NO')
        OR (column_name = 'name' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'sort' AND data_type = 'smallint' AND is_nullable = 'NO')
      )
  ) AS passed;

SELECT
  'product_categories_seeded' AS check_name,
  (
    SELECT count(*) = 9
    FROM public.product_categories
    WHERE (id, lower(slug::text), name) IN (
      (1, 'education', 'Education'),
      (2, 'software',  'Software'),
      (3, 'ebooks',    'eBooks'),
      (4, 'video',     'Video'),
      (5, 'audio',     'Audio'),
      (6, 'graphics',  'Graphics'),
      (7, 'business',  'Business'),
      (8, 'health',    'Health'),
      (9, 'finance',   'Finance')
    )
  ) AS passed;

-- 4. The enum, in order.
SELECT
  'product_status_labels' AS check_name,
  coalesce(
    (
      SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'product_status'
    ) = ARRAY['draft', 'submitted', 'live', 'paused', 'rejected', 'archived'],
    false
  ) AS passed;

-- 5. public.products: the money, commission and lifecycle columns.
SELECT
  'products_columns' AS check_name,
  (
    SELECT count(*) = 23
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND (
        (column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO'
          AND column_default = 'gen_random_uuid()')
        OR (column_name = 'vendor_id' AND data_type = 'uuid' AND is_nullable = 'NO')
        OR (column_name = 'category_id' AND data_type = 'smallint' AND is_nullable = 'NO')
        OR (column_name = 'title' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'slug' AND data_type = 'USER-DEFINED' AND is_nullable = 'NO')
        OR (column_name = 'short_description' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'description' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'price_kobo' AND data_type = 'bigint' AND is_nullable = 'NO')
        OR (column_name = 'compare_at_price_kobo' AND data_type = 'bigint' AND is_nullable = 'YES')
        OR (column_name = 'currency' AND data_type = 'text' AND is_nullable = 'NO'
          AND column_default = '''NGN''::text')
        OR (column_name = 'commission_bps' AND data_type = 'integer' AND is_nullable = 'NO')
        OR (column_name = 'affiliate_approval' AND data_type = 'text' AND is_nullable = 'NO'
          AND column_default = '''open''::text')
        OR (column_name = 'refund_window_hours' AND data_type = 'integer' AND is_nullable = 'NO'
          AND column_default = '24')
        OR (column_name = 'max_downloads' AND data_type = 'integer' AND is_nullable = 'NO'
          AND column_default = '5')
        OR (column_name = 'status' AND data_type = 'USER-DEFINED' AND is_nullable = 'NO'
          AND column_default = '''draft''::product_status')
        OR (column_name = 'reject_reason' AND data_type = 'text')
        OR (column_name = 'submitted_at' AND data_type = 'timestamp with time zone')
        OR (column_name = 'published_at' AND data_type = 'timestamp with time zone')
        OR (column_name = 'reviewed_at' AND data_type = 'timestamp with time zone')
        OR (column_name = 'reviewed_by' AND data_type = 'uuid')
        OR (column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO')
        OR (column_name = 'updated_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO')
        OR (column_name = 'search_vector' AND data_type = 'tsvector' AND is_generated = 'ALWAYS')
      )
  ) AS passed;

-- 6. Every money and lifecycle rule is enforced by the table itself.
SELECT
  'products_checks' AS check_name,
  (
    SELECT bool_and(EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'products'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%' || p.pattern || '%'
    ))
    FROM (VALUES
      ('char_length(title)'),
      ('char_length(short_description)'),
      ('char_length(description)'),
      ('price_kobo >= 10000'),
      ('compare_at_price_kobo > price_kobo'),
      ('currency = ''NGN'''),
      ('commission_bps >= 500'),
      ('affiliate_approval = ANY'),
      ('refund_window_hours >= 24'),
      ('max_downloads >= 1'),
      ('[a-z0-9][a-z0-9-]{2,78}[a-z0-9]')
    ) AS p(pattern)
  ) AS passed;

-- 7. Slug uniqueness is case-insensitive, and the address pattern is anchored.
SELECT
  'slug_unique_case_insensitive' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'products'
      AND i.indisunique
      AND pg_get_indexdef(i.indexrelid) LIKE '%(slug)%'
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'products'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%[a-z0-9][a-z0-9-]{2,78}[a-z0-9]%'
  ) AND (
    SELECT atttypid::regtype::text
    FROM pg_attribute
    WHERE attrelid = 'public.products'::regclass AND attname = 'slug'
  ) = 'extensions.citext' AS passed;

-- 8. Search: one generated tsvector column with a GIN index, and a trigram
--    index on the title.
SELECT
  'search_indexes' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND indexname = 'products_search_idx'
      AND indexdef LIKE '%USING gin (search_vector)%'
  )
  AND EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND indexname = 'products_title_trgm_idx'
      AND indexdef LIKE '%gin_trgm_ops%'
  ) AS passed;

-- 9. The shelf, the review queue and the category filters are indexed.
SELECT
  'lookup_indexes' AS check_name,
  (
    SELECT count(*) = 3
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND indexname IN (
        'products_vendor_status_idx', 'products_status_submitted_idx', 'products_category_idx'
      )
  ) AS passed;

-- 10. public.product_files: shape of the reservation table.
SELECT
  'product_files_columns' AS check_name,
  (
    SELECT count(*) = 11
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_files'
      AND (
        (column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO'
          AND column_default IS NULL)
        OR (column_name = 'product_id' AND data_type = 'uuid' AND is_nullable = 'NO')
        OR (column_name = 'storage_key' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'original_name' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'content_type' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'size_bytes' AND data_type = 'bigint' AND is_nullable = 'NO')
        OR (column_name = 'status' AND data_type = 'text' AND is_nullable = 'NO'
          AND column_default = '''pending''::text')
        OR (column_name = 'scan_status' AND data_type = 'text' AND is_nullable = 'NO'
          AND column_default = '''not_scanned''::text')
        OR (column_name = 'multipart_upload_id' AND data_type = 'text')
        OR (column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO')
        OR (column_name = 'uploaded_at' AND data_type = 'timestamp with time zone')
      )
  ) AS passed;

-- 11. The file limits are enforced by the table: 2 GiB per file, a positive
--     size, and the two status vocabularies.
SELECT
  'product_files_checks' AS check_name,
  (
    SELECT bool_and(EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'product_files'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%' || p.pattern || '%'
    ))
    FROM (VALUES
      ('size_bytes > 0'),
      ('2147483648'),
      ('char_length(original_name)'),
      ('status = ANY'),
      ('scan_status = ANY')
    ) AS p(pattern)
  ) AS passed;

-- 12. public.product_images: shape, and exactly one cover per product.
SELECT
  'product_images_columns' AS check_name,
  (
    SELECT count(*) = 11
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_images'
      AND (
        (column_name = 'id' AND data_type = 'uuid' AND is_nullable = 'NO'
          AND column_default = 'gen_random_uuid()')
        OR (column_name = 'product_id' AND data_type = 'uuid' AND is_nullable = 'NO')
        OR (column_name = 'cloudinary_public_id' AND data_type = 'text' AND is_nullable = 'NO')
        OR (column_name = 'alt_text' AND data_type = 'text')
        OR (column_name = 'width' AND data_type = 'integer')
        OR (column_name = 'height' AND data_type = 'integer')
        OR (column_name = 'bytes' AND data_type = 'integer')
        OR (column_name = 'format' AND data_type = 'text')
        OR (column_name = 'sort' AND data_type = 'smallint' AND is_nullable = 'NO'
          AND column_default = '0')
        OR (column_name = 'is_cover' AND data_type = 'boolean' AND is_nullable = 'NO'
          AND column_default = 'false')
        OR (column_name = 'created_at' AND data_type = 'timestamp with time zone' AND is_nullable = 'NO')
      )
  ) AS passed;

SELECT
  'one_cover_per_product' AS check_name,
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'product_images'
      AND i.indisunique
      AND pg_get_indexdef(i.indexrelid) LIKE '%(product_id)%'
      AND pg_get_expr(i.indpred, i.indrelid) = 'is_cover'
  ) AS passed;

-- 13. Row level security is enabled on all four tables.
SELECT
  'rls_enabled_every_table' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('product_categories'), ('products'), ('product_files'), ('product_images')
    ) AS t(tbl)
    JOIN pg_class c ON c.relname = t.tbl
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r' AND c.relrowsecurity = false
  ) AS passed;

-- 14. Policy counts: one for the public category list, two for each product
--     table (owner and staff). None of them grants a write.
SELECT
  'policy_counts_match' AS check_name,
  bool_and(coalesce(a.policy_count, 0) = e.policy_count) AS passed
FROM (VALUES
  ('product_categories', 1),
  ('products', 2),
  ('product_files', 2),
  ('product_images', 2)
) AS e(tbl, policy_count)
LEFT JOIN (
  SELECT tablename, count(*) AS policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd = 'SELECT'
  GROUP BY tablename
) AS a ON a.tablename = e.tbl;

SELECT
  'no_write_policies' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('product_categories', 'products', 'product_files', 'product_images')
      AND cmd <> 'SELECT'
  ) AS passed;

-- 15. An anonymous visitor reads the category list and nothing else.
SELECT
  'anon_reads_categories_only' AS check_name,
  has_table_privilege('anon', 'public.product_categories', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.products', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.product_files', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.product_images', 'SELECT')
  AS passed;

-- 16. A signed-in user reads products, files and images, and writes none of
--     them.
SELECT
  'authenticated_read_only' AS check_name,
  has_table_privilege('authenticated', 'public.products', 'SELECT')
  AND has_table_privilege('authenticated', 'public.product_files', 'SELECT')
  AND has_table_privilege('authenticated', 'public.product_images', 'SELECT')
  AND has_table_privilege('authenticated', 'public.product_categories', 'SELECT')
  AND NOT EXISTS (
    SELECT 1
    FROM (VALUES ('products'), ('product_files'), ('product_images'), ('product_categories')) AS t(tbl)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
    WHERE has_table_privilege('authenticated', 'public.' || t.tbl, p.priv)
  ) AS passed;

-- 17. Neither client role may write, and anon holds no write privilege either.
SELECT
  'clients_have_no_write_privileges' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS r(role_name)
    CROSS JOIN (VALUES ('products'), ('product_files'), ('product_images'), ('product_categories')) AS t(tbl)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
    WHERE has_table_privilege(r.role_name, 'public.' || t.tbl, p.priv)
  ) AS passed;

-- 18. The service role holds full privileges on all four tables.
SELECT
  'service_role_full_table_privileges' AS check_name,
  (
    SELECT bool_and(
      has_table_privilege('service_role', 'public.' || t.tbl, p.priv)
    )
    FROM (VALUES ('products'), ('product_files'), ('product_images'), ('product_categories')) AS t(tbl)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
  ) AS passed;

-- 19. Every catalog function exists, is SECURITY DEFINER, and pins search_path
--     to an empty string.
SELECT
  'functions_security_definer' AS check_name,
  (
    SELECT count(*) = 17
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'catalog_setting_int', 'get_product_readiness', 'catalog_actor_is_vendor',
        'catalog_owns_product', 'catalog_slugify', 'create_product_draft', 'update_product',
        'product_transition', 'register_product_file', 'confirm_product_file',
        'delete_product_file', 'add_product_image', 'remove_product_image', 'set_cover_image',
        'list_stale_pending_files', 'purge_pending_file', 'log_product_file_admin_access'
      )
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']
  ) AS passed;

-- 20. The signatures the application calls. A changed return type is a breaking
--     change for lib/catalog/actions, so it is checked explicitly.
SELECT
  'function_signatures' AS check_name,
  (
    SELECT count(*) = 6
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        (p.proname = 'get_product_readiness' AND p.pronargs = 1
          AND pg_get_function_result(p.oid) = 'jsonb')
        OR (p.proname = 'create_product_draft' AND p.pronargs = 2
          AND pg_get_function_result(p.oid) = 'uuid')
        OR (p.proname = 'update_product' AND p.pronargs = 3
          AND pg_get_function_result(p.oid) = 'void')
        OR (p.proname = 'product_transition' AND p.pronargs = 4
          AND pg_get_function_result(p.oid) = 'text')
        OR (p.proname = 'delete_product_file' AND p.pronargs = 2
          AND pg_get_function_result(p.oid) = 'text')
        OR (p.proname = 'list_stale_pending_files' AND p.pronargs = 1
          AND pg_get_function_result(p.oid) =
            'TABLE(id uuid, storage_key text, multipart_upload_id text)')
      )
      AND n.nspname = 'public'
  ) AS passed;

-- 21. The service role may execute every catalog function.
SELECT
  'functions_service_role_can_execute' AS check_name,
  (
    SELECT count(*) = 17
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'catalog_setting_int', 'get_product_readiness', 'catalog_actor_is_vendor',
        'catalog_owns_product', 'catalog_slugify', 'create_product_draft', 'update_product',
        'product_transition', 'register_product_file', 'confirm_product_file',
        'delete_product_file', 'add_product_image', 'remove_product_image', 'set_cover_image',
        'list_stale_pending_files', 'purge_pending_file', 'log_product_file_admin_access'
      )
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS passed;

-- 22. No client role may execute any of them.
SELECT
  'functions_closed_to_clients' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'catalog_setting_int', 'get_product_readiness', 'catalog_actor_is_vendor',
        'catalog_owns_product', 'catalog_slugify', 'create_product_draft', 'update_product',
        'product_transition', 'register_product_file', 'confirm_product_file',
        'delete_product_file', 'add_product_image', 'remove_product_image', 'set_cover_image',
        'list_stale_pending_files', 'purge_pending_file', 'log_product_file_admin_access'
      )
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')
  ) AS passed;

-- 23. The settings reader answers the fallback when a row is missing, which is
--     what keeps a fresh project usable before anyone edits public.settings.
SELECT
  'setting_fallback' AS check_name,
  public.catalog_setting_int('a_key_that_does_not_exist', 42) = 42
  AND public.catalog_setting_int('refund_window_min_hours', 7) = 24
  AS passed;

-- 24. The migration recorded itself.
SELECT
  'app_migrations_row' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.app_migrations
    WHERE version = '20261114000100'
      AND name = 'catalog'
  ) AS passed;
