-- Player-safe start-guard context for contract-v2 quiz starts.
--
-- Authenticated players cannot read quiz_events rows directly: RLS restricts
-- v2 rows to merchant users and routes player reads through safe projection
-- RPCs (see 20260804090000_quiz_live_event_foundation.sql). The production
-- start guards therefore resolve mode/merchant here instead of issuing a
-- direct table read that RLS would silently empty.
--
-- Compliance evidence itself is never exposed: the function returns only a
-- boolean live-prize verdict computed from the regulatory columns, mirroring
-- getQuizComplianceEvidence + compliance_verified. Mode, merchant, and the
-- verdict are already discoverable through the player event listing and the
-- start flow, so no additional caller scoping is applied; the security-definer
-- start RPCs retain attempt authorization.
CREATE OR REPLACE FUNCTION public.get_quiz_start_guard_context_v2(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
BEGIN
  SELECT
    mode,
    merchant_id,
    regulatory_basis,
    regulatory_jurisdiction,
    regulatory_evidence_ref,
    compliance_verified
  INTO v_event
  FROM public.quiz_events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('found', false);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'found', true,
    'mode', v_event.mode,
    'merchant_id', v_event.merchant_id,
    'prize_approved', (
      v_event.compliance_verified IS TRUE
      AND v_event.regulatory_basis IN (
        'free_skill_competition', 'state_permit', 'fccpc_registration'
      )
      AND pg_catalog.btrim(COALESCE(v_event.regulatory_jurisdiction, '')) <> ''
      AND pg_catalog.btrim(COALESCE(v_event.regulatory_evidence_ref, '')) <> ''
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_start_guard_context_v2(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_start_guard_context_v2(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_quiz_start_guard_context_v2(uuid)
  IS 'Player-safe mode/merchant/live-prize verdict for quiz start guards.';
