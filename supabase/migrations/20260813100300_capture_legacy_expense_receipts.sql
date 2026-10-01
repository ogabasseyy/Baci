-- Capture the exact legacy receipt path before an edit clears its URL.

CREATE TABLE IF NOT EXISTS private.expense_legacy_receipt_cleanup_candidates (
  expense_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (expense_id, storage_path)
);

CREATE INDEX IF NOT EXISTS expense_legacy_receipt_cleanup_candidates_created_at_idx
  ON private.expense_legacy_receipt_cleanup_candidates (created_at);

ALTER TABLE private.expense_legacy_receipt_cleanup_candidates
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.expense_legacy_receipt_cleanup_candidates
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
    v_storage_path := regexp_replace(
      OLD.receipt_url,
      '^.*?/object/public/media/',
      ''
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

REVOKE ALL ON FUNCTION private.capture_legacy_expense_receipt_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS capture_legacy_expense_receipt_cleanup ON public.expenses;
CREATE TRIGGER capture_legacy_expense_receipt_cleanup
  AFTER UPDATE OF receipt_url ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION private.capture_legacy_expense_receipt_cleanup();
