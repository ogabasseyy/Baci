-- Reserve the RDM- discount-code prefix for loyalty redemptions (issue #3165).
--
-- Checkout resolves merchant discount_codes before loyalty redemptions, so a
-- merchant RDM-* code shadows the customer's already-paid loyalty code. The
-- web Zod schemas reject the prefix, but mobile-admin writes discount_codes
-- directly with no validation; enforce the reservation at the database
-- boundary so every writer is covered. A trigger on INSERT and UPDATE OF
-- code (not a CHECK constraint): CHECK re-validates grandfathered legacy
-- rows on ANY update and would brick their deactivation edits, while the
-- trigger fires only when the code itself is written. Legacy rows stay
-- harmless because the 05 mint probe already avoids any RDM-* value
-- present in discount_codes.
CREATE OR REPLACE FUNCTION public.reject_rdm_discount_code_prefix()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF upper(NEW.code) LIKE 'RDM-%' THEN
    RAISE EXCEPTION 'discount code prefix RDM- is reserved for loyalty redemptions'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS discount_codes_no_rdm_prefix ON public.discount_codes;
CREATE TRIGGER discount_codes_no_rdm_prefix
  BEFORE INSERT OR UPDATE OF code ON public.discount_codes
  FOR EACH ROW EXECUTE FUNCTION public.reject_rdm_discount_code_prefix();
