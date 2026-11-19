-- Store the residential recovery suggestion separately so confirmed application
-- creation can discard identity and account inputs without losing the address.
ALTER TABLE public.oxygen_form_drafts ALTER COLUMN ciphertext DROP NOT NULL;
ALTER TABLE public.oxygen_form_drafts
 ADD COLUMN residential_ciphertext text,
 ADD COLUMN residential_version integer,
 ADD CONSTRAINT oxygen_residential_draft_ciphertext_check CHECK (
  (residential_ciphertext IS NULL AND residential_version IS NULL) OR
  (residential_ciphertext IS NOT NULL AND length(residential_ciphertext) BETWEEN 32 AND 16384 AND residential_version IS NOT NULL AND residential_version > 0)
 );

-- Serialize all customer writes with the workflow transition. RLS is checked
-- again after waiting, so an old form cannot restore identity after submission.
CREATE FUNCTION oxygen_private.lock_draft_workflow_for_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_stage text;
BEGIN
 SELECT stage INTO current_stage FROM public.oxygen_workflows WHERE id=NEW.workflow_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Draft no longer editable' USING ERRCODE='40001';
 END IF;
 IF current_stage <> 'application_required' AND NOT (
  TG_OP='UPDATE' AND pg_trigger_depth()=2 AND OLD.ciphertext IS NOT NULL
  AND NEW.ciphertext IS NULL AND OLD.residential_ciphertext IS NOT NULL
  AND NEW.workflow_id IS NOT DISTINCT FROM OLD.workflow_id
  AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
  AND NEW.version=OLD.version+1
  AND NEW.residential_ciphertext IS NOT DISTINCT FROM OLD.residential_ciphertext
  AND NEW.residential_version IS NOT DISTINCT FROM OLD.residential_version
  AND NEW.mutation_id IS NOT DISTINCT FROM OLD.mutation_id
  AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
  AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
  AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
 ) THEN
  RAISE EXCEPTION 'Draft no longer editable' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.lock_draft_workflow_for_write() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER oxygen_draft_workflow_write_lock BEFORE INSERT OR UPDATE ON public.oxygen_form_drafts
FOR EACH ROW EXECUTE FUNCTION oxygen_private.lock_draft_workflow_for_write();

-- This trigger runs in the same transaction as the successful command record.
-- Legacy rows lack an encrypted address-only copy; retain those for recovery
-- until the existing address-DONE purge or the seven-day retention sweep.
CREATE FUNCTION oxygen_private.minimize_submitted_draft()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status='executing' AND NEW.status='succeeded'
  AND NEW.command->>'action'='start_application'
  AND EXISTS (SELECT 1 FROM oxygen_private.provider_states s WHERE s.workflow_id=NEW.workflow_id AND s.state->>'applicationReference' IS NOT NULL)
 THEN
  UPDATE public.oxygen_form_drafts SET ciphertext=NULL,version=version+1
  WHERE workflow_id=NEW.workflow_id AND ciphertext IS NOT NULL AND residential_ciphertext IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.minimize_submitted_draft() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER oxygen_minimize_submitted_draft AFTER UPDATE OF status ON oxygen_private.commands
FOR EACH ROW EXECUTE FUNCTION oxygen_private.minimize_submitted_draft();
NOTIFY pgrst,'reload schema';
