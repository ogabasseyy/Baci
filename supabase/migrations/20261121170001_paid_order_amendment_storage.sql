-- No pilot configuration is seeded. Only a trusted database operator admits scenarios.
CREATE TABLE private.paid_order_amendment_config (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id),
  version bigint NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL DEFAULT false,
  scenarios text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE private.paid_order_amendment_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  actor_id uuid NOT NULL,
  selection jsonb NOT NULL,
  quote jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX paid_order_amendment_previews_order_idx
  ON private.paid_order_amendment_previews(order_id);
CREATE INDEX paid_order_amendment_previews_expiry_idx
  ON private.paid_order_amendment_previews(expires_at);

CREATE TABLE private.paid_order_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL,
  config_version bigint NOT NULL,
  settlement_route text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'settled', 'awaiting_payment', 'awaiting_refund', 'reversed', 'cancelled_for_recovery'
  )),
  hold_fulfillment boolean NOT NULL,
  balance_due_minor bigint NOT NULL CHECK (balance_due_minor >= 0),
  refund_owed_minor bigint NOT NULL CHECK (refund_owed_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paid_order_amendments_merchant_idx
  ON private.paid_order_amendments(merchant_id);

CREATE TABLE private.paid_order_amendment_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amendment_id uuid NOT NULL REFERENCES private.paid_order_amendments(id),
  revision integer NOT NULL CHECK (revision > 0),
  original_document_inputs jsonb NOT NULL,
  revised_order_inputs jsonb NOT NULL,
  UNIQUE (amendment_id, revision)
);

CREATE TABLE private.paid_order_amendment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  amendment_id uuid NOT NULL REFERENCES private.paid_order_amendments(id),
  actor_id uuid,
  event_type text NOT NULL,
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paid_order_amendment_events_amendment_idx
  ON private.paid_order_amendment_events(amendment_id, id);

ALTER TABLE private.paid_order_amendment_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_amendment_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_amendment_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_amendment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_amendment_config, private.paid_order_amendment_previews,
  private.paid_order_amendments, private.paid_order_amendment_revisions,
  private.paid_order_amendment_events FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.reject_paid_order_amendment_history_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'immutable_order_amendment_history' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER paid_order_amendment_revisions_immutable
BEFORE UPDATE OR DELETE ON private.paid_order_amendment_revisions
FOR EACH ROW EXECUTE FUNCTION private.reject_paid_order_amendment_history_rewrite();
CREATE TRIGGER paid_order_amendment_events_immutable
BEFORE UPDATE OR DELETE ON private.paid_order_amendment_events
FOR EACH ROW EXECUTE FUNCTION private.reject_paid_order_amendment_history_rewrite();
REVOKE ALL ON FUNCTION private.reject_paid_order_amendment_history_rewrite()
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.can_access_paid_order_amendment(p_merchant_id uuid, p_action text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.merchants
      WHERE id = p_merchant_id AND user_id = (SELECT auth.uid()))
    OR COALESCE(public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'orders', p_action
    ), false)
  );
$$;
REVOKE ALL ON FUNCTION private.can_access_paid_order_amendment(uuid,text)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.paid_order_amendment_summary(p_order_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'amendmentId', a.id, 'revisionId', r.id, 'state', a.state,
    'holdFulfillment', a.hold_fulfillment,
    'balanceDueMinor', a.balance_due_minor, 'refundOwedMinor', a.refund_owed_minor
  )
  FROM private.paid_order_amendments AS a
  JOIN LATERAL (
    SELECT id FROM private.paid_order_amendment_revisions
    WHERE amendment_id = a.id ORDER BY revision DESC LIMIT 1
  ) AS r ON true
  WHERE a.order_id = p_order_id;
$$;
REVOKE ALL ON FUNCTION private.paid_order_amendment_summary(uuid)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.read_paid_order_amendment(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant uuid;
BEGIN
  SELECT merchant_id INTO v_merchant FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.can_access_paid_order_amendment(v_merchant, 'view')
     AND NOT private.can_access_paid_order_amendment(v_merchant, 'edit') THEN
    RAISE EXCEPTION 'amendment_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'summary', private.paid_order_amendment_summary(p_order_id),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'type', e.event_type, 'actorId', e.actor_id,
        'createdAt', e.created_at, 'details', e.details
      ) ORDER BY e.id)
      FROM private.paid_order_amendment_events e
      JOIN private.paid_order_amendments a ON a.id = e.amendment_id
      WHERE a.order_id = p_order_id
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.read_paid_order_amendment(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.read_paid_order_amendment(uuid) TO authenticated;

CREATE TABLE private.paid_order_checkout_claims (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  reference text NOT NULL UNIQUE,
  gateway text NOT NULL,
  currency text NOT NULL,
  expected_amount_minor bigint NOT NULL CHECK (expected_amount_minor > 0),
  order_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.paid_order_checkout_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_checkout_claims FROM PUBLIC, anon, authenticated, service_role;
