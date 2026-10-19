-- Capture private receipt paths transactionally and queue unreferenced upload orphans.

ALTER TABLE private.expense_private_receipt_cleanup_candidates
  ALTER COLUMN expense_id DROP NOT NULL;

ALTER TABLE private.expense_private_receipt_cleanup_candidates
  DROP CONSTRAINT IF EXISTS expense_private_receipt_cleanup_candidates_pkey;

ALTER TABLE private.expense_private_receipt_cleanup_candidates
  ADD PRIMARY KEY (merchant_id, storage_path);

CREATE OR REPLACE FUNCTION private.capture_private_expense_receipt_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.receipt_storage_path IS NOT NULL
     AND OLD.receipt_storage_path IS DISTINCT FROM NEW.receipt_storage_path
     AND OLD.receipt_storage_path ~ (
       '^' || OLD.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
     )
     AND NOT private.expense_receipt_is_referenced(OLD.receipt_storage_path) THEN
    INSERT INTO private.expense_private_receipt_cleanup_candidates (
      expense_id, merchant_id, storage_path
    )
    VALUES (OLD.id, OLD.merchant_id, OLD.receipt_storage_path)
    ON CONFLICT (merchant_id, storage_path) DO UPDATE
      SET expense_id = EXCLUDED.expense_id,
          created_at = now(),
          claimed_at = NULL;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_private_expense_receipt_cleanup()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS capture_private_expense_receipt_cleanup ON public.expenses;
CREATE TRIGGER capture_private_expense_receipt_cleanup
  AFTER UPDATE OF receipt_storage_path ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION private.capture_private_expense_receipt_cleanup();

CREATE OR REPLACE FUNCTION public.queue_expense_private_receipt_cleanup(
  p_expense_id uuid,
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_expense_id IS NULL
     OR p_merchant_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ (
       '^' || p_merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
     ) THEN
    RETURN false;
  END IF;

  IF NOT public.check_staff_permission(
    auth.uid(), p_merchant_id, 'expenses', 'edit'
  ) THEN
    RAISE EXCEPTION 'Not authorized to queue private expense receipt cleanup';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expenses AS target_expense
    WHERE target_expense.id = p_expense_id
      AND target_expense.merchant_id = p_merchant_id
      AND (
        target_expense.receipt_storage_path IS NULL
        OR target_expense.receipt_storage_path <> p_storage_path
      )
  ) THEN
    RETURN false;
  END IF;

  IF private.expense_receipt_is_referenced(p_storage_path) THEN
    RETURN false;
  END IF;

  INSERT INTO private.expense_private_receipt_cleanup_candidates (
    expense_id, merchant_id, storage_path
  )
  VALUES (p_expense_id, p_merchant_id, p_storage_path)
  ON CONFLICT (merchant_id, storage_path) DO UPDATE
    SET expense_id = EXCLUDED.expense_id,
        created_at = now(),
        claimed_at = NULL;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_unreferenced_expense_private_receipt_cleanup(
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_merchant_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ (
       '^' || p_merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
     ) THEN
    RETURN false;
  END IF;

  IF NOT (
    public.check_staff_permission(auth.uid(), p_merchant_id, 'expenses', 'edit')
    OR public.check_staff_permission(auth.uid(), p_merchant_id, 'expenses', 'create')
  ) THEN
    RAISE EXCEPTION 'Not authorized to queue unreferenced private expense receipt cleanup';
  END IF;

  IF private.expense_receipt_is_referenced(p_storage_path) THEN
    RETURN false;
  END IF;

  INSERT INTO private.expense_private_receipt_cleanup_candidates (
    expense_id, merchant_id, storage_path
  )
  VALUES (NULL, p_merchant_id, p_storage_path)
  ON CONFLICT (merchant_id, storage_path) DO UPDATE
    SET created_at = now(),
        claimed_at = NULL;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_expense_private_receipt_cleanup(
  p_expense_id uuid,
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  IF p_merchant_id IS NULL OR p_storage_path IS NULL THEN
    RETURN false;
  END IF;

  DELETE FROM private.expense_private_receipt_cleanup_candidates AS candidate
  WHERE candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path
    AND (
      p_expense_id IS NULL
      OR candidate.expense_id = p_expense_id
      OR candidate.expense_id IS NULL
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.authorize_expense_private_receipt_cleanup_deletion(
  p_expense_id uuid,
  p_merchant_id uuid,
  p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_merchant_id IS NULL
     OR p_storage_path IS NULL
     OR p_storage_path !~ (
       '^' || p_merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
     ) THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM private.expense_private_receipt_cleanup_candidates AS candidate
  WHERE candidate.merchant_id = p_merchant_id
    AND candidate.storage_path = p_storage_path
    AND (
      p_expense_id IS NULL
      OR candidate.expense_id = p_expense_id
      OR candidate.expense_id IS NULL
    )
    AND candidate.claimed_at IS NOT NULL
    AND candidate.claimed_at >= now() - interval '10 minutes'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF private.expense_receipt_is_referenced(p_storage_path) THEN
    UPDATE private.expense_private_receipt_cleanup_candidates AS candidate
    SET claimed_at = NULL
    WHERE candidate.merchant_id = p_merchant_id
      AND candidate.storage_path = p_storage_path;
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.queue_unreferenced_expense_private_receipt_cleanup(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_unreferenced_expense_private_receipt_cleanup(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_expense_private_receipt_cleanup_candidates(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  expense_id uuid,
  merchant_id uuid,
  storage_path text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid private receipt cleanup batch limit';
  END IF;

  DELETE FROM private.expense_private_receipt_cleanup_candidates AS candidate
  WHERE candidate.storage_path !~ (
        '^' || candidate.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
      )
     OR private.expense_receipt_is_referenced(candidate.storage_path);

  RETURN QUERY
  WITH to_claim AS (
    SELECT candidate.expense_id, candidate.merchant_id, candidate.storage_path
    FROM private.expense_private_receipt_cleanup_candidates AS candidate
    WHERE (candidate.claimed_at IS NULL OR candidate.claimed_at < now() - interval '10 minutes')
      AND candidate.storage_path ~ (
        '^' || candidate.merchant_id::text || '/expenses/[A-Za-z0-9][A-Za-z0-9._-]*$'
      )
      AND NOT private.expense_receipt_is_referenced(candidate.storage_path)
    ORDER BY candidate.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE private.expense_private_receipt_cleanup_candidates AS candidate
  SET claimed_at = now()
  FROM to_claim
  WHERE candidate.merchant_id = to_claim.merchant_id
    AND candidate.storage_path = to_claim.storage_path
  RETURNING candidate.expense_id, candidate.merchant_id, candidate.storage_path;
END;
$function$;
