-- Encrypted partial inputs only. These rows never authorize provider or financial actions.
CREATE TABLE public.oxygen_form_drafts (
  workflow_id uuid PRIMARY KEY REFERENCES public.oxygen_workflows(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 32 AND 16384),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  mutation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX oxygen_form_drafts_user_idx ON public.oxygen_form_drafts(user_id);
CREATE INDEX oxygen_form_drafts_expiry_idx ON public.oxygen_form_drafts(expires_at);
ALTER TABLE public.oxygen_form_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oxygen_form_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oxygen_form_drafts TO authenticated;

CREATE POLICY oxygen_draft_read ON public.oxygen_form_drafts FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.oxygen_workflows w WHERE w.id = workflow_id
));
CREATE POLICY oxygen_draft_insert ON public.oxygen_form_drafts FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()) AND version = 1 AND EXISTS (
  SELECT 1 FROM public.oxygen_workflows w WHERE w.id = workflow_id
    AND w.stage = 'application_required' AND w.environment = 'staging'
));
CREATE POLICY oxygen_draft_update ON public.oxygen_form_drafts FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.oxygen_workflows w WHERE w.id = workflow_id
    AND w.stage = 'application_required' AND w.environment = 'staging'
))
WITH CHECK (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.oxygen_workflows w WHERE w.id = workflow_id
    AND w.stage = 'application_required' AND w.environment = 'staging'
));
CREATE POLICY oxygen_draft_delete ON public.oxygen_form_drafts FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()) AND EXISTS (
  SELECT 1 FROM public.oxygen_workflows w WHERE w.id = workflow_id
));

CREATE FUNCTION public.oxygen_form_draft_revision_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workflow_id IS DISTINCT FROM OLD.workflow_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.version <> OLD.version + 1 OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Invalid draft revision' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.expires_at := least(NEW.expires_at, now() + interval '7 days');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.oxygen_form_draft_revision_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER oxygen_form_draft_revision BEFORE INSERT OR UPDATE ON public.oxygen_form_drafts
FOR EACH ROW EXECUTE FUNCTION public.oxygen_form_draft_revision_guard();

-- Managed Supabase can purge expired ciphertext hourly when pg_cron is enabled.
-- Disposable test hosts without pg_cron still enforce expiration in the draft API.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    EXECUTE $job$SELECT cron.schedule('oxygen-form-draft-expiry', '17 * * * *',
      'DELETE FROM public.oxygen_form_drafts WHERE expires_at <= now()')$job$;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
