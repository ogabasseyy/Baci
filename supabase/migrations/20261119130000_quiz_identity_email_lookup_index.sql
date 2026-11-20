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

-- A cancelled or failed concurrent build leaves an invalid index of the same
-- name. IF NOT EXISTS would then skip the build on every retry, so remove that
-- artifact first. Only an invalid index with the expected shape is dropped.
DO $cleanup$
DECLARE existing record;
BEGIN
  SELECT i.indisvalid, i.indisready, pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
    INTO existing
  FROM pg_catalog.pg_index i
  WHERE i.indexrelid = pg_catalog.to_regclass('public.idx_customers_merchant_quiz_normalized_email_all');
  IF FOUND AND (NOT existing.indisvalid OR NOT existing.indisready) THEN
    IF existing.definition !~
      '^CREATE INDEX idx_customers_merchant_quiz_normalized_email_all ON public\.customers USING btree \(merchant_id, (public\.)?quiz_normalize_email\(email\)\)$' THEN
      RAISE EXCEPTION 'Invalid quiz identity email lookup index does not match the expected definition: %', existing.definition;
    END IF;
    -- Invalid indexes do not serve reads. Bound the brief lock a transactional
    -- DROP INDEX needs; never wait indefinitely on a busy customers table.
    PERFORM pg_catalog.set_config('lock_timeout', '2s', true);
    DROP INDEX public.idx_customers_merchant_quiz_normalized_email_all;
  END IF;
END;
$cleanup$;

-- Built concurrently so customer writes are not blocked during the build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_merchant_quiz_normalized_email_all
  ON public.customers (merchant_id, public.quiz_normalize_email(email));

-- Fail loudly unless the index is present, valid and has the expected shape.
-- pg_get_indexdef is a reconstruction whose schema qualification depends on
-- search_path, so the function's "public." prefix is optional in the match.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO definition
  FROM pg_catalog.pg_index i
  WHERE i.indexrelid = pg_catalog.to_regclass('public.idx_customers_merchant_quiz_normalized_email_all')
    AND i.indisvalid AND i.indisready;
  IF definition IS NULL OR definition !~
    '^CREATE INDEX idx_customers_merchant_quiz_normalized_email_all ON public\.customers USING btree \(merchant_id, (public\.)?quiz_normalize_email\(email\)\)$' THEN
    RAISE EXCEPTION 'Quiz identity email lookup index missing, invalid or changed: %', definition;
  END IF;
END $$;
