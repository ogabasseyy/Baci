-- Normalize legacy public receipt URLs before validating storage paths.

CREATE OR REPLACE FUNCTION private.legacy_expense_receipt_storage_path_from_url(
  p_receipt_url text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT split_part(
    split_part(
      regexp_replace(p_receipt_url, '^.*?/object/public/media/', ''),
      '?',
      1
    ),
    '#',
    1
  );
$function$;

REVOKE ALL ON FUNCTION private.legacy_expense_receipt_storage_path_from_url(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.capture_legacy_expense_receipt_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_storage_path text;
BEGIN
  IF OLD.receipt_url IS NOT NULL
     AND OLD.receipt_url IS DISTINCT FROM NEW.receipt_url THEN
    v_storage_path := private.legacy_expense_receipt_storage_path_from_url(
      OLD.receipt_url
    );
    IF v_storage_path IS DISTINCT FROM OLD.receipt_url
       AND v_storage_path ~ ('^expenses/' || OLD.merchant_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$') THEN
      INSERT INTO private.expense_legacy_receipt_cleanup_candidates (
        expense_id, merchant_id, storage_path
      )
      VALUES (OLD.id, OLD.merchant_id, v_storage_path)
      ON CONFLICT (expense_id, storage_path) DO UPDATE
        SET created_at = now();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.block_claimed_legacy_expense_receipt_restoration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_storage_path text;
BEGIN
  IF NEW.receipt_url IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.receipt_url IS DISTINCT FROM OLD.receipt_url
     ) THEN
    v_storage_path := private.legacy_expense_receipt_storage_path_from_url(
      NEW.receipt_url
    );

    IF v_storage_path IS DISTINCT FROM NEW.receipt_url
       AND EXISTS (
         SELECT 1
         FROM private.expense_legacy_receipt_cleanup_candidates AS candidate
         WHERE candidate.storage_path = v_storage_path
           AND candidate.claimed_at IS NOT NULL
           AND candidate.claimed_at >= now() - interval '10 minutes'
       ) THEN
      RAISE EXCEPTION 'Legacy expense receipt is pending cleanup'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_legacy_expense_receipt_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION private.block_claimed_legacy_expense_receipt_restoration()
  FROM PUBLIC, anon, authenticated, service_role;
