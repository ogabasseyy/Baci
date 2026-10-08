LOCK TABLE private.uba_redvault_discount_binding IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.discount_codes IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE redvault_fixed_five_fixture (
  bound_code_id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  unrelated_code_id uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  original_binding_count integer NOT NULL DEFAULT 0
) ON COMMIT DROP;
INSERT INTO redvault_fixed_five_fixture(original_binding_count)
SELECT count(*)::integer FROM private.uba_redvault_discount_binding;

CREATE TEMP TABLE redvault_fixed_five_history AS
SELECT 'applications'::text AS source, to_jsonb(application.*) AS row_data
FROM private.uba_redvault_applications AS application
UNION ALL
SELECT 'allocations', to_jsonb(allocation.*)
FROM private.uba_redvault_line_allocations AS allocation
UNION ALL
SELECT 'usage', to_jsonb(usage_row.*)
FROM public.discount_code_usage AS usage_row;

ALTER TABLE private.uba_redvault_discount_binding
  DISABLE TRIGGER validate_redvault_discount_binding;
DELETE FROM private.uba_redvault_discount_binding;
ALTER TABLE private.uba_redvault_discount_binding
  ENABLE TRIGGER validate_redvault_discount_binding;

INSERT INTO public.discount_codes(
  id, merchant_id, code, description, discount_type, discount_value,
  minimum_purchase_amount, maximum_discount_amount, usage_limit, usage_count,
  usage_limit_per_customer, starts_at, expires_at, is_active, applies_to,
  product_ids, category_ids
)
SELECT fixture.bound_code_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  'RV10-' || pg_catalog.left(fixture.bound_code_id::text, 8),
  'Rollback-only fixed-five predecessor fixture', 'percentage', 10,
  0, 250, 900, 17, 4, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z',
  true, 'all', '[]'::jsonb, '[]'::jsonb
FROM redvault_fixed_five_fixture AS fixture;

INSERT INTO public.discount_codes(
  id, merchant_id, code, description, discount_type, discount_value,
  minimum_purchase_amount, maximum_discount_amount, usage_limit, usage_count,
  usage_limit_per_customer, starts_at, expires_at, is_active, applies_to,
  product_ids, category_ids
)
SELECT fixture.unrelated_code_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  'RVU10-' || pg_catalog.left(fixture.unrelated_code_id::text, 8),
  'Rollback-only unrelated discount fixture', 'percentage', 10,
  40, 400, 700, 23, 5, '2026-02-01T00:00:00Z', '2027-02-01T00:00:00Z',
  true, 'all', '[]'::jsonb, '[]'::jsonb
FROM redvault_fixed_five_fixture AS fixture;

CREATE TEMP TABLE redvault_fixed_five_expected_codes AS
SELECT code.id, to_jsonb(code.*) AS original_row
FROM public.discount_codes AS code
JOIN redvault_fixed_five_fixture AS fixture
  ON code.id IN (fixture.bound_code_id, fixture.unrelated_code_id);

ALTER TABLE private.uba_redvault_discount_binding
  DISABLE TRIGGER validate_redvault_discount_binding;
INSERT INTO private.uba_redvault_discount_binding(discount_code_id, merchant_id, partnership)
SELECT bound_code_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'uba_redvault'
FROM redvault_fixed_five_fixture;
ALTER TABLE private.uba_redvault_discount_binding
  ENABLE TRIGGER validate_redvault_discount_binding;

CREATE FUNCTION pg_temp.assert_redvault_fixed_five_history_unchanged()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT source, row_data FROM redvault_fixed_five_history
    EXCEPT
    SELECT source, row_data FROM (
      SELECT 'applications'::text AS source, to_jsonb(application.*) AS row_data
      FROM private.uba_redvault_applications AS application
      UNION ALL
      SELECT 'allocations', to_jsonb(allocation.*)
      FROM private.uba_redvault_line_allocations AS allocation
      UNION ALL
      SELECT 'usage', to_jsonb(usage_row.*)
      FROM public.discount_code_usage AS usage_row
    ) AS current_history
  ) OR EXISTS (
    SELECT source, row_data FROM (
      SELECT 'applications'::text AS source, to_jsonb(application.*) AS row_data
      FROM private.uba_redvault_applications AS application
      UNION ALL
      SELECT 'allocations', to_jsonb(allocation.*)
      FROM private.uba_redvault_line_allocations AS allocation
      UNION ALL
      SELECT 'usage', to_jsonb(usage_row.*)
      FROM public.discount_code_usage AS usage_row
    ) AS current_history
    EXCEPT
    SELECT source, row_data FROM redvault_fixed_five_history
  ) THEN
    RAISE EXCEPTION 'redvault_fixed_five_historical_rows_changed';
  END IF;
END;
$$;
