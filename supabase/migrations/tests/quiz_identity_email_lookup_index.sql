BEGIN;

DO $$
DECLARE
  v_index regclass := to_regclass('public.idx_customers_merchant_quiz_normalized_email_all');
  v_definition text;
  v_plan json;
BEGIN
  IF v_index IS NULL THEN
    RAISE EXCEPTION 'quiz identity email lookup index missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    WHERE i.indexrelid = v_index
      AND i.indrelid = 'public.customers'::regclass
      AND i.indisvalid
      AND i.indisready
      AND i.indpred IS NULL
      AND NOT i.indisunique
  ) THEN
    RAISE EXCEPTION 'quiz identity email lookup index must be a valid, unfiltered, non-unique index on customers';
  END IF;

  v_definition := pg_catalog.pg_get_indexdef(v_index);
  IF v_definition !~ '\(merchant_id, (public\.)?quiz_normalize_email\(email\)\)$' THEN
    RAISE EXCEPTION 'unexpected quiz identity email lookup index definition: %', v_definition;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.quiz_normalize_email(text)'::regprocedure
      AND p.provolatile = 'i'
  ) THEN
    RAISE EXCEPTION 'quiz_normalize_email must stay IMMUTABLE for the expression index';
  END IF;

  -- The cap trigger's identity lookup must be able to use the index. Sequential
  -- scans are discouraged so the assertion does not depend on table size: this
  -- proves the index is a usable candidate for the lookup, not that the planner
  -- picks it at production statistics. The replayed database has too few
  -- customer rows for an unforced plan to be meaningful.
  SET LOCAL enable_seqscan = off;
  SET LOCAL enable_bitmapscan = off;
  EXECUTE $plan$
    EXPLAIN (FORMAT JSON)
    SELECT c.id
    FROM public.customers c
    WHERE c.merchant_id = '00000000-0000-4000-8000-000000000001'::uuid
      AND public.quiz_normalize_email(c.email) = 'player@example.com'
  $plan$ INTO v_plan;

  IF v_plan::text NOT LIKE '%idx_customers_merchant_quiz_normalized_email_all%' THEN
    RAISE EXCEPTION 'identity lookup does not use the quiz email index: %', v_plan;
  END IF;
END;
$$;

ROLLBACK;
