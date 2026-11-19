-- Residential context is needed until address verification completes. Once
-- Oxygen confirms it, the encrypted identity draft is no longer needed.
CREATE FUNCTION oxygen_private.purge_completed_address_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.state->'kyc'->>'address_status' = 'DONE' AND EXISTS (
    SELECT 1 FROM public.oxygen_workflows w
    WHERE w.id=NEW.workflow_id AND w.stage <> 'application_required'
  ) THEN
    DELETE FROM public.oxygen_form_drafts WHERE workflow_id=NEW.workflow_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.purge_completed_address_draft() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oxygen_purge_draft_on_address_done
  AFTER INSERT OR UPDATE OF state ON oxygen_private.provider_states
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.purge_completed_address_draft();

CREATE FUNCTION oxygen_private.purge_draft_after_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.stage <> 'application_required' AND EXISTS (
    SELECT 1 FROM oxygen_private.provider_states s
    WHERE s.workflow_id=NEW.id AND s.state->'kyc'->>'address_status'='DONE'
  ) THEN
    DELETE FROM public.oxygen_form_drafts WHERE workflow_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION oxygen_private.purge_draft_after_application() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oxygen_purge_completed_draft_on_progress
  AFTER UPDATE OF stage ON public.oxygen_workflows
  FOR EACH ROW EXECUTE FUNCTION oxygen_private.purge_draft_after_application();

DELETE FROM public.oxygen_form_drafts d USING public.oxygen_workflows w, oxygen_private.provider_states s
WHERE d.workflow_id=w.id AND s.workflow_id=w.id AND w.stage <> 'application_required'
  AND s.state->'kyc'->>'address_status'='DONE';
