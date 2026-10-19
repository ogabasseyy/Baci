BEGIN;
CREATE FUNCTION prefunded_card.fence_provider_evidence_conflict(p_integration uuid,p_event text,p_references jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE operation prefunded_card.operations%ROWTYPE;
BEGIN
  PERFORM id FROM prefunded_card.treasury_bindings WHERE integration_id=p_integration ORDER BY id FOR UPDATE;
  FOR operation IN SELECT candidate.* FROM prefunded_card.operations candidate WHERE candidate.integration_id=p_integration
    AND (p_references ? candidate.transfer_reference OR p_references ? candidate.collection_reference
      OR p_references ? candidate.transfer_provider_transaction_id OR p_references ? candidate.collection_provider_transaction_id
      OR EXISTS(SELECT 1 FROM prefunded_card.provider_aliases alias WHERE alias.operation_id=candidate.id
        AND alias.integration_id=p_integration AND p_references ? alias.provider_transaction_id))
    ORDER BY candidate.id FOR UPDATE LOOP
    INSERT INTO prefunded_card.evidence_conflicts(integration_id,event_id,operation_id,already_applied)
      VALUES(p_integration,p_event,operation.id,operation.projection_status='applied') ON CONFLICT DO NOTHING;
    IF operation.projection_status<>'applied' THEN
      UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id=operation.id;
    END IF;
  END LOOP;
  INSERT INTO prefunded_card.bank_evidence_conflicts(integration_id,provider_transaction_id,conflicting_event_id)
    SELECT projection.integration_id,projection.provider_transaction_id,p_event FROM prefunded_card.bank_projections projection
      JOIN prefunded_card.provider_evidence receipt ON receipt.integration_id=projection.integration_id AND receipt.event_id=projection.event_id
      WHERE projection.integration_id=p_integration AND (p_references ? projection.provider_transaction_id
        OR (receipt.observation->'references') ?| ARRAY(SELECT jsonb_array_elements_text(p_references)))
    ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION prefunded_card.fence_provider_evidence_conflict(uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,pvb_staging_app_worker;
COMMIT;
