-- Reserve the RDM- discount-code prefix for loyalty redemptions (issue #3165).
--
-- Checkout resolves merchant discount_codes before loyalty redemptions, so a
-- merchant RDM-* code shadows the customer's already-paid loyalty code. The
-- web Zod schemas reject the prefix, but mobile-admin writes discount_codes
-- directly with no validation; enforce the reservation at the database
-- boundary so every writer is covered. NOT VALID: pre-existing rows are
-- grandfathered (no backfill failure at deploy) while all new and updated
-- rows comply. Legacy rows stay harmless because the 05 mint probe already
-- avoids any RDM-* value present in discount_codes.
ALTER TABLE public.discount_codes
  ADD CONSTRAINT discount_codes_no_rdm_prefix
  CHECK (upper(code) NOT LIKE 'RDM-%') NOT VALID;
