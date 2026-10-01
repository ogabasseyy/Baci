CREATE OR REPLACE FUNCTION private.reject_redvault_item_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM private.uba_redvault_applications WHERE order_id = v_order_id) THEN
    IF TG_OP = 'UPDATE'
      AND (to_jsonb(NEW) - 'fulfillment_data') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'fulfillment_data')
      AND (
        EXISTS (
          SELECT 1
          FROM private.uba_redvault_write_context
          WHERE transaction_id = pg_catalog.txid_current()
        )
        OR private.redvault_approved_completion_durable(v_order_id)
      ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'redvault_order_snapshot_immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
ALTER FUNCTION private.reject_redvault_item_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_redvault_item_mutation() FROM PUBLIC, anon, authenticated, service_role;
