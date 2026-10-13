-- Orders edited through the legacy admin RPC have an audit event but may not
-- have the newer server-authored marker. Preserve that historical provenance
-- before transaction review applies its VAT-inclusive negotiation heuristic.
BEGIN;

CREATE TEMP TABLE historical_admin_discount_edits (
  order_id uuid PRIMARY KEY,
  updated_at timestamptz
) ON COMMIT DROP;

-- Lock the matching orders before capturing updated_at so a concurrent order
-- update cannot be overwritten by a stale staged timestamp.
SELECT orders.id
FROM public.orders AS orders
JOIN (
  SELECT DISTINCT order_id
  FROM public.order_audit_events
  WHERE action = 'order.update'
    AND changed_fields && ARRAY['items', 'subtotal', 'discount_amount']::text[]
) AS audit ON audit.order_id = orders.id
FOR UPDATE OF orders;

INSERT INTO historical_admin_discount_edits (order_id, updated_at)
SELECT DISTINCT audit.order_id, orders.updated_at
FROM public.order_audit_events AS audit
JOIN public.orders AS orders ON orders.id = audit.order_id
WHERE audit.action = 'order.update'
  AND audit.changed_fields && ARRAY['items', 'subtotal', 'discount_amount']::text[];

-- The orders trigger accepts the admin marker only when this transaction-local
-- context row is present. Seed it for the backfill so the marker is not
-- stripped as an untrusted client update.
INSERT INTO private.transaction_discount_admin_edit_context (
  transaction_id,
  order_id
)
SELECT pg_catalog.txid_current(), edits.order_id
FROM historical_admin_discount_edits AS edits
JOIN public.orders AS orders ON orders.id = edits.order_id
WHERE COALESCE(orders.discount_amount, 0) > 0
  AND NOT (
    pg_catalog.jsonb_typeof(orders.ad_tracking) = 'object'
    AND orders.ad_tracking ? 'baci_transaction_discount'
  )
ON CONFLICT DO NOTHING;

-- Preserve payment recency while adding the marker. This migration is
-- transactional, so a failed UPDATE rolls back the temporary trigger state.
ALTER TABLE public.orders DISABLE TRIGGER "update_orders_updated_at";

UPDATE public.orders AS orders
SET
  ad_tracking = pg_catalog.jsonb_set(
    CASE
      WHEN pg_catalog.jsonb_typeof(orders.ad_tracking) = 'object'
        THEN orders.ad_tracking
      ELSE '{}'::jsonb
    END,
    ARRAY['baci_transaction_discount'],
    jsonb_build_object(
      'status', 'admin_edit',
      'version', 4,
      'source', 'historical_audit'
    ),
    true
  ),
  updated_at = edits.updated_at
FROM historical_admin_discount_edits AS edits
WHERE orders.id = edits.order_id
  AND COALESCE(orders.discount_amount, 0) > 0
  AND NOT (
    pg_catalog.jsonb_typeof(orders.ad_tracking) = 'object'
    AND orders.ad_tracking ? 'baci_transaction_discount'
  );

ALTER TABLE public.orders ENABLE TRIGGER "update_orders_updated_at";

DELETE FROM private.transaction_discount_admin_edit_context AS context
USING historical_admin_discount_edits AS edits
WHERE context.transaction_id = pg_catalog.txid_current()
  AND context.order_id = edits.order_id;

COMMIT;
