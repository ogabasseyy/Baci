CREATE OR REPLACE FUNCTION private.redvault_approved_completion_durable(p_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.uba_redvault_applications AS application
    JOIN private.uba_redvault_payment_attempts AS attempt
      ON attempt.application_id = application.id
    WHERE application.order_id = p_order_id
      AND application.status = 'approved'
      AND attempt.state = 'approved'
      AND jsonb_typeof(attempt.provider_response->'completion_receipt') = 'object'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt') = 'object'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryConfirmed' = 'true'
      AND jsonb_typeof(attempt.provider_response->'inventory_completion_receipt'->'inventoryReclaimedUnitCount') = 'number'
      AND attempt.provider_response->'inventory_completion_receipt'->>'inventoryReclaimedUnitCount' ~ '^(0|[1-9][0-9]*)$'
      AND NOT EXISTS (
        SELECT 1
        FROM private.uba_redvault_refunds AS refund
        WHERE refund.attempt_id = attempt.id
          AND refund.state IN ('pending', 'processing', 'processed')
      )
  );
$$;
ALTER FUNCTION private.redvault_approved_completion_durable(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.redvault_approved_completion_durable(uuid) FROM PUBLIC, anon, authenticated, service_role;
