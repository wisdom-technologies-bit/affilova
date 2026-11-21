-- ============================================================================
-- Migration 20261121000100_policy_acceptance_fn
-- Target: Supabase Postgres. Run in the Supabase SQL Editor as the postgres role.
-- Scope:  Adds public.record_policy_acceptance(uuid, text, text, text) so
--         onboarding actions record each accepted policy document individually
--         (e.g. vendor_agreement, affiliate_agreement, terms_of_service,
--         privacy_policy) and append a 'policy.accepted' row to public.audit_log.
-- This file is idempotent: running it twice must not raise an error.
-- Depends on 20261112000100_foundation.sql (public.audit_log, app_migrations)
-- and 20261113000100_roles_onboarding.sql (public.policy_acceptances).
-- ============================================================================

BEGIN;

-- Confirm row level security remains enabled on policy_acceptances.
ALTER TABLE public.policy_acceptances ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_policy_acceptance(
  p_user    uuid,
  p_policy  text,
  p_version text,
  p_ip_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy        text;
  v_version       text;
  v_ip_hash       text;
  v_acceptance_id bigint;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'p_user is required';
  END IF;

  v_policy := pg_catalog.btrim(coalesce(p_policy, ''));
  IF v_policy = '' THEN
    RAISE EXCEPTION 'p_policy is required';
  END IF;

  v_version := pg_catalog.btrim(coalesce(p_version, ''));
  IF v_version = '' THEN
    RAISE EXCEPTION 'p_version is required';
  END IF;

  v_ip_hash := nullif(pg_catalog.btrim(coalesce(p_ip_hash, '')), '');

  INSERT INTO public.policy_acceptances (user_id, policy, version, ip_hash)
  VALUES (p_user, v_policy, v_version, v_ip_hash)
  ON CONFLICT (user_id, policy, version) DO NOTHING
  RETURNING id INTO v_acceptance_id;

  IF v_acceptance_id IS NOT NULL THEN
    INSERT INTO public.audit_log (
      actor_id,
      action,
      entity_type,
      entity_id,
      after,
      ip_hash
    )
    VALUES (
      p_user,
      'policy.accepted',
      'policy_acceptance',
      v_acceptance_id::text,
      pg_catalog.jsonb_build_object('policy', v_policy, 'version', v_version),
      v_ip_hash
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_policy_acceptance(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_policy_acceptance(uuid, text, text, text)
  TO service_role;

INSERT INTO public.app_migrations (version, name)
VALUES ('20261121000100', 'policy_acceptance_fn')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- Run the block below to undo this migration. It is commented out on purpose:
-- the file above is what runs. Existing rows in public.policy_acceptances and
-- public.audit_log are preserved because they record real user acceptances.
--
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.record_policy_acceptance(uuid, text, text, text);
--
-- DELETE FROM public.app_migrations WHERE version = '20261121000100';
--
-- COMMIT;
-- ============================================================================
