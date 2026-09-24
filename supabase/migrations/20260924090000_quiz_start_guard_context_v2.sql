-- Player-safe start-guard context for contract-v2 quiz starts.
--
-- Authenticated players cannot read quiz_events rows directly: RLS restricts
-- v2 rows to merchant users and routes player reads through safe projection
-- RPCs (see 20260804090000_quiz_live_event_foundation.sql). The production
-- start guards therefore resolve mode/merchant here instead of issuing a
-- direct table read that RLS would silently empty.
--
-- Authorization mirrors the caller-visibility checks of list_quiz_events_v2
-- (20260804123000): contract v2, a listed lifecycle status, a non-deleted
-- customer relationship with the event merchant, plus tester entitlement
-- (or merchant access) for test events and the shared regulatory-readiness
-- helper for live events. Anything else returns found=false, so callers
-- cannot distinguish missing, draft, cancelled, or unapproved events from
-- ones they may not see. service_role bypasses the caller checks for
-- trusted replay/admin paths but remains scoped to v2 listed-lifecycle rows.
--
-- Startability (active window, rules acceptance, attempt caps) stays with the
-- security-definer start RPCs, which reject precisely; this projection only
-- answers what an entitled player may already discover from the listing.
-- Compliance evidence itself is never exposed: player-visible live rows are
-- ready by construction, and the verdict comes from the shared helper.
CREATE OR REPLACE FUNCTION public.get_quiz_start_guard_context_v2(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_merchant_id uuid;
  v_prize_approved boolean;
BEGIN
  SELECT
    event.mode,
    event.merchant_id,
    private.quiz_live_prize_regulatory_ready_v2(event.id)
  INTO v_mode, v_merchant_id, v_prize_approved
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id
    AND event.contract_version = 2
    AND event.status IN ('scheduled', 'active', 'completed')
    AND (
      auth.role() = 'service_role'
      OR (
        EXISTS (
          SELECT 1
          FROM public.customers AS customer
          WHERE customer.merchant_id = event.merchant_id
            AND customer.user_id = auth.uid()
            AND customer.deleted_at IS NULL
        )
        AND (
          (
            event.mode = 'test'
            AND (
              EXISTS (
                SELECT 1
                FROM public.quiz_event_testers AS tester
                WHERE tester.event_id = event.id
                  AND tester.user_id = auth.uid()
                  AND tester.revoked_at IS NULL
              )
              OR public.has_merchant_access(event.merchant_id)
            )
          )
          OR (
            event.mode = 'live'
            AND private.quiz_live_prize_regulatory_ready_v2(event.id)
          )
        )
      )
    );

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('found', false);
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'found', true,
    'mode', v_mode,
    'merchant_id', v_merchant_id,
    'prize_approved', v_prize_approved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_start_guard_context_v2(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_start_guard_context_v2(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_quiz_start_guard_context_v2(uuid)
  IS 'Entitlement-scoped mode/merchant/live-prize verdict for quiz start guards.';
