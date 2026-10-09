
-- Date-correction cases for admin_order_date_edit.sql. Not standalone.

-- Legacy omission must preserve the date and create no date audit entry.
DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_date_events integer;
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id, '{}'::jsonb);
  SELECT count(*) INTO v_date_events FROM order_audit_events
  WHERE order_id = v_id AND changed_fields @> ARRAY['transaction_date'];
  IF v_date_events <> 0 THEN
    RAISE EXCEPTION 'omitted date generated audit';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_result jsonb;
  v_events integer;
BEGIN
  v_result := public.update_admin_order_with_transaction_discount_metadata(v_id,
    '{"transaction_date":"2024-01-02T10:00:00Z"}');
  IF NOT (v_result -> 'changed_fields' @> '["transaction_date"]'::jsonb)
    OR NOT EXISTS (SELECT 1 FROM orders WHERE id = v_id
      AND transaction_date = '2024-01-02T10:00:00Z'
      AND created_at = '2026-01-01T10:00:00Z')
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_id
      AND changed_fields = ARRAY['transaction_date']
      AND before_snapshot -> 'transaction_date' = 'null'::jsonb
      AND (before_snapshot ->> 'effective_transaction_date')::timestamptz = '2026-01-01T10:00:00Z'
      AND after_snapshot ->> 'transaction_date' IS NOT NULL)
  THEN RAISE EXCEPTION 'backdate persistence/audit failed'; END IF;
  -- One save produces one audit record: the date fields merge into the
  -- delegated event instead of a second insert.
  SELECT count(*) INTO v_events FROM order_audit_events WHERE order_id = v_id;
  IF v_events <> 2 THEN
    RAISE EXCEPTION 'date correction was not merged into one audit event';
  END IF;
END;
$$;

DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
  v_date_events integer;
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(v_id,
    '{"transaction_date":"2024-01-02T10:00:00Z"}');
  SELECT count(*) INTO v_date_events FROM order_audit_events
  WHERE order_id = v_id AND changed_fields @> ARRAY['transaction_date'];
  IF v_date_events <> 1 THEN
    RAISE EXCEPTION 'unchanged date generated audit';
  END IF;
END;
$$;

-- Manual orders move explicit document dates with the corrected day.
DO $$
DECLARE
  v_manual_id uuid := '55555555-5555-4555-8555-555555555555';
  v_result jsonb;
BEGIN
  v_result := public.update_admin_order_with_transaction_discount_metadata(
    v_manual_id,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-02"}');
  IF NOT (v_result -> 'changed_fields' @>
      '["transaction_date","invoice_issue_date","tax_point_date"]'::jsonb)
    OR NOT EXISTS (SELECT 1 FROM orders WHERE id = v_manual_id
      AND transaction_date = '2024-01-02T10:00:00Z'
      AND invoice_issue_date = '2024-01-02'
      AND invoice_issue_date_generated = false
      AND tax_point_date = '2024-01-02'
      AND tax_point_date_generated = false)
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_manual_id
      AND changed_fields =
        ARRAY['transaction_date','invoice_issue_date','tax_point_date']
      AND before_snapshot ->> 'invoice_issue_date' = '2024-05-01'
      AND after_snapshot ->> 'invoice_issue_date' = '2024-01-02'
      AND before_snapshot ->> 'tax_point_date' = '2024-05-01'
      AND after_snapshot ->> 'tax_point_date' = '2024-01-02')
  THEN RAISE EXCEPTION 'manual document date sync/audit failed'; END IF;
END;
$$;

-- The explicit device day wins over merchant-timezone derivation, so a
-- device ahead of the merchant near midnight keeps its picked day.
DO $$
DECLARE
  v_manual_id uuid := '55555555-5555-4555-8555-555555555555';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_manual_id,
    '{"transaction_date":"2024-01-02T11:00:00Z","transaction_date_day":"2024-01-03"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_manual_id
    AND invoice_issue_date = '2024-01-03'
    AND tax_point_date = '2024-01-03') THEN
    RAISE EXCEPTION 'explicit document day ignored';
  END IF;
END;
$$;

-- A lingering generated flag clears even when the date value already
-- matches, so the sync trigger cannot rewrite the device-selected day.
DO $$
DECLARE
  v_flag_id uuid := '66666666-6666-4666-8666-666666666666';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_flag_id,
    '{"transaction_date":"2024-01-02T11:00:00Z","transaction_date_day":"2024-01-02"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_flag_id
    AND invoice_issue_date_generated = false
    AND tax_point_date_generated = false)
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_flag_id
      AND changed_fields @>
        ARRAY['transaction_date','invoice_issue_date','tax_point_date'])
  THEN RAISE EXCEPTION 'generated flag not cleared'; END IF;
END;
$$;

-- A differing explicit day is honored even when the instant matches, so
-- cross-timezone day corrections are not silently dropped.
DO $$
DECLARE
  v_flag_id uuid := '66666666-6666-4666-8666-666666666666';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_flag_id,
    '{"transaction_date":"2024-01-02T11:00:00Z","transaction_date_day":"2024-01-03"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_flag_id
    AND transaction_date = '2024-01-02T11:00:00Z'
    AND invoice_issue_date = '2024-01-03'
    AND tax_point_date = '2024-01-03')
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_flag_id
      AND changed_fields @> ARRAY['invoice_issue_date','tax_point_date']
      AND NOT (changed_fields @> ARRAY['transaction_date']))
  THEN RAISE EXCEPTION 'day-only correction dropped'; END IF;
END;
$$;

-- Manual classification follows the post-edit channel: an online order
-- moved to physical in the same edit syncs its document dates.
DO $$
DECLARE
  v_src_id uuid := '77777777-7777-4777-8777-777777777777';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_src_id,
    '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-02","source":"physical"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_src_id
    AND source = 'physical'
    AND invoice_issue_date = '2024-01-02'
    AND tax_point_date = '2024-01-02') THEN
    RAISE EXCEPTION 'post-edit source not used for manual sync';
  END IF;
END;
$$;

-- A differing explicit day on a non-manual order with a matching instant is
-- rejected instead of silently dropped.
DO $$
DECLARE
  v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_id,
      '{"transaction_date":"2024-01-02T10:00:00Z","transaction_date_day":"2024-01-03"}');
    RAISE EXCEPTION 'non-manual day mismatch accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%order_date_invalid%'
      OR SQLERRM LIKE '%order_date_in_future%' THEN
      RAISE EXCEPTION 'non-manual day code wrong: %', SQLERRM;
    END IF;
  END;
END;
$$;

-- The reverse move skips the sync and preserves explicit document dates.
DO $$
DECLARE
  v_manual_id uuid := '55555555-5555-4555-8555-555555555555';
BEGIN
  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_manual_id,
    '{"transaction_date":"2024-01-04T10:00:00Z","source":"online_store"}');
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = v_manual_id
    AND source = 'online_store'
    AND transaction_date = '2024-01-04T10:00:00Z'
    AND invoice_issue_date = '2024-01-03'
    AND tax_point_date = '2024-01-03')
    OR NOT EXISTS (SELECT 1 FROM order_audit_events
      WHERE order_id = v_manual_id
      AND changed_fields = ARRAY['transaction_date']
      AND after_snapshot ->> 'transaction_date' IS NOT NULL)
  THEN RAISE EXCEPTION 'reverse channel move mishandled'; END IF;
END;
$$;

