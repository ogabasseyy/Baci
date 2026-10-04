BEGIN;
CREATE FUNCTION prefunded_card.guard_collection_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.collection_status='reversed' AND (NEW.collection_status<>'reversed'
    OR NEW.collection_provider_transaction_id IS DISTINCT FROM OLD.collection_provider_transaction_id) THEN
    RAISE EXCEPTION 'prefunded collection reversal is terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.collection_status='reversed' OR EXISTS (
    SELECT 1 FROM prefunded_card.collection_reversal_obligations WHERE operation_id=OLD.id
  ) THEN
    IF (OLD.collection_status='not_started' AND NEW.collection_status='dispatching')
      OR (OLD.transfer_status='not_started' AND NEW.transfer_status='dispatching')
      OR (OLD.projection_status<>'applied' AND NEW.projection_status='applied') THEN
      RAISE EXCEPTION 'prefunded reversal requires reconciliation' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prefunded_collection_reversal_guard BEFORE UPDATE ON prefunded_card.operations
  FOR EACH ROW EXECUTE FUNCTION prefunded_card.guard_collection_reversal();
REVOKE ALL ON FUNCTION prefunded_card.guard_collection_reversal() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
