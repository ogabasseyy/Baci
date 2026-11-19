-- disable-transaction
-- The email-identity attempt cap (public.quiz_enforce_identity_attempt_cap,
-- QZ040) runs on every quiz attempt start and looks customers up by
-- (merchant_id, quiz_normalize_email(email)). No index covered that
-- expression, so each start read the merchant's whole customer list or every
-- attempt in the event, and the cost grew with the size of the crowd.
--
-- Deliberately unfiltered: the cap counts every customer row of the merchant,
-- including soft-deleted ones, so a partial index would not match its query.
-- quiz_normalize_email is IMMUTABLE, which an expression index requires.
-- Built concurrently so customer writes are not blocked during the build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_merchant_quiz_normalized_email_all
  ON public.customers (merchant_id, public.quiz_normalize_email(email));

-- A failed concurrent build leaves an invalid index that IF NOT EXISTS would
-- silently keep, so fail loudly unless the index is present, valid and exact.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO definition
  FROM pg_catalog.pg_index i
  WHERE i.indexrelid = pg_catalog.to_regclass('public.idx_customers_merchant_quiz_normalized_email_all')
    AND i.indisvalid AND i.indisready;
  IF definition IS DISTINCT FROM
    'CREATE INDEX idx_customers_merchant_quiz_normalized_email_all ON public.customers USING btree (merchant_id, quiz_normalize_email(email))' THEN
    RAISE EXCEPTION 'Quiz identity email lookup index missing, invalid or changed: %', definition;
  END IF;
END $$;
