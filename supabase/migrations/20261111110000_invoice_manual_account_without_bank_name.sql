-- Invoice accounts remain visible when the bank directory has no name.
-- Keep the v2 dispatch comparison and rearm trigger aligned with that card.
DO $migration$
DECLARE
  definition text;
  previous text;
  replacement text;
BEGIN
  definition := pg_get_functiondef('public.mark_manual_document_dispatch_started_v2'::regproc);
  previous := $old$OR (CASE WHEN NULLIF(private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code), '') IS NOT NULL
              THEN NULLIF(v_merchant_bank_account_number, '') END)
            IS DISTINCT FROM p_merchant_bank_account_number
        OR (NULLIF(v_merchant_bank_account_number, '') IS NOT NULL
          AND NULLIF(private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code), '') IS NOT NULL
          AND (private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code)
                IS DISTINCT FROM p_merchant_bank_name
            OR v_merchant_bank_account_name IS DISTINCT FROM p_merchant_bank_account_name))$old$;
  replacement := $new$OR NULLIF(v_merchant_bank_account_number, '') IS DISTINCT FROM p_merchant_bank_account_number
        OR (NULLIF(v_merchant_bank_account_number, '') IS NOT NULL
          AND (private.resolved_merchant_bank_name(v_merchant_bank_name, v_merchant_bank_code)
                IS DISTINCT FROM p_merchant_bank_name
            OR v_merchant_bank_account_name IS DISTINCT FROM p_merchant_bank_account_name))$new$;
  IF strpos(definition, previous) = 0 THEN
    RAISE EXCEPTION 'Expected v2 invoice bank comparison is missing';
  END IF;
  EXECUTE replace(definition, previous, replacement);

  definition := pg_get_functiondef('private.rearm_manual_documents_after_merchant_update()'::regprocedure);
  previous := $old$((NULLIF(OLD.bank_account_number, '') IS NOT NULL
              AND private.resolved_merchant_bank_name(OLD.bank_name, OLD.bank_code) <> '')
          OR (NULLIF(NEW.bank_account_number, '') IS NOT NULL
              AND private.resolved_merchant_bank_name(NEW.bank_name, NEW.bank_code) <> ''))$old$;
  replacement := $new$(NULLIF(OLD.bank_account_number, '') IS NOT NULL
          OR NULLIF(NEW.bank_account_number, '') IS NOT NULL)$new$;
  IF strpos(definition, previous) = 0 THEN
    RAISE EXCEPTION 'Expected invoice bank rearm guard is missing';
  END IF;
  EXECUTE replace(definition, previous, replacement);
END;
$migration$;
