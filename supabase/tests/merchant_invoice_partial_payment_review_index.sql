INSERT INTO public.reconciliation_review (issue_type, order_id)
VALUES
  ('gateway_payment_wedge_requires_review', '00000000-0000-0000-0000-000000000001'),
  ('gateway_payment_wedge_requires_review', '00000000-0000-0000-0000-000000000001'),
  ('merchant_invoice_partial_payment_conflict', '00000000-0000-0000-0000-000000000002'),
  ('merchant_invoice_partial_payment_conflict', '00000000-0000-0000-0000-000000000002');

INSERT INTO public.reconciliation_review (issue_type, order_id)
VALUES ('payment_match_ambiguous', '00000000-0000-0000-0000-000000000003');

DO $$
BEGIN
  BEGIN
    INSERT INTO public.reconciliation_review (issue_type, order_id)
    VALUES ('payment_match_ambiguous', '00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'expected duplicate indexed review to be rejected';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END;
$$;
