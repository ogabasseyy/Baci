-- Follow-up reminder pushes (part 1 of 4: the table, its row-level security,
-- the send mark and the new event kind; part 2 is the sweep functions, part 3 the
-- push log wording, part 4 the retry functions).
--
-- A store team member sets a follow-up on a chat in the mobile admin app
-- (Messages > Follow up). When that time arrives the team's phones get one push
-- ("Follow up: <customer>"). The chat engine reopens the chat at that time but
-- clears its own snooze time when it does, so the due time cannot be read back
-- afterwards. The time is therefore recorded here when the follow-up is SET,
-- by the caller's own session under row-level security.
--
-- A short-interval cron sweep (CRON_SECRET-protected, no session) then reads
-- the reminders that came due in the last 24 hours and records each one
-- exactly once. Those two steps have no user session, so they go through two
-- narrow SECURITY DEFINER functions with the same short-lived HMAC proof model
-- as record_chat_handover (same server-only secret, a different proof label
-- per function, so no proof can be replayed as another kind).
-- The push itself reuses the proof-and-claim push wrappers of
-- 20261115100000_chat_customer_message_push.sql through a chat event row of the
-- new kind 'follow_up'.
BEGIN;

-- One pending reminder per chat. Setting another follow-up time on the same
-- chat replaces the row under a NEW id (the id is the reminder's identity, and
-- keys its push event), so a replaced reminder can never be sent by a sweep
-- that listed it earlier. The trigger below assigns it.
CREATE TABLE IF NOT EXISTS public.chat_follow_up_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  conversation_id bigint NOT NULL CHECK (conversation_id > 0),
  due_at timestamptz NOT NULL,
  -- Bounded customer name for the push title; empty when the chat has no real
  -- name. No message text is stored here.
  customer_name text NOT NULL DEFAULT '' CHECK (char_length(customer_name) <= 80),
  -- Set when the sweep took this reminder (sent, muted or found stale).
  processed_at timestamptz,
  -- Set each time the sweep lists this reminder. The sweep lists the ones it
  -- has not looked at yet first, so reminders it cannot act on (an unreadable
  -- chat engine for one store) never starve the other stores' reminders.
  last_listed_at timestamptz,
  -- How many times the sweep took this reminder. A push that provably never
  -- left the server is retried, and this bounds how often.
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  -- Also the index on merchant_id for the foreign key.
  CONSTRAINT chat_follow_up_reminders_chat_key UNIQUE (merchant_id, conversation_id)
);

-- Serves the sweep's due-window read and its cleanup of week-old rows. The
-- table only holds pending and recently handled reminders, so it stays small.
CREATE INDEX IF NOT EXISTS chat_follow_up_reminders_due_idx
  ON public.chat_follow_up_reminders (due_at);

ALTER TABLE public.chat_follow_up_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_follow_up_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_follow_up_reminders TO authenticated;

-- The store owner and staff may see reminders with the inbox "view" or "edit"
-- permission and change them with "edit": the same permissions the inbox API
-- itself asks for. "edit" does not imply "view", and Postgres needs the row to
-- be visible to replace or remove it. check_staff_permission answers for the signed-in
-- caller only (and recognises the owner), and is used instead of an inline
-- merchants/staff_members subquery so the policy cannot recurse.
DROP POLICY IF EXISTS chat_follow_up_reminders_select ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_select ON public.chat_follow_up_reminders
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'view')
    OR public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit')
  );
DROP POLICY IF EXISTS chat_follow_up_reminders_insert ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_insert ON public.chat_follow_up_reminders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit')
    AND due_at <= pg_catalog.now() + interval '91 days'
    -- A follow-up is set for later: a past time would push at once.
    AND due_at > pg_catalog.now() - interval '10 minutes'
  );
DROP POLICY IF EXISTS chat_follow_up_reminders_update ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_update ON public.chat_follow_up_reminders
  FOR UPDATE TO authenticated
  USING (public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit'))
  WITH CHECK (
    public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit')
    AND due_at <= pg_catalog.now() + interval '91 days'
    -- A follow-up is set for later: a past time would push at once.
    AND due_at > pg_catalog.now() - interval '10 minutes'
  );
DROP POLICY IF EXISTS chat_follow_up_reminders_delete ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_delete ON public.chat_follow_up_reminders
  FOR DELETE TO authenticated
  USING (public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit'));

-- A signed-in writer chooses the chat, the time and the name only: the identity
-- and what the sweep did with a reminder are the database's record. A new time
-- is a new follow-up (new identity, nothing handled); the same time keeps its
-- identity and history, so a handled reminder cannot be made due again. The
-- sweep's own functions run as the owner and are not affected.
CREATE OR REPLACE FUNCTION private.guard_chat_follow_up_reminder() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.due_at = OLD.due_at
    AND NEW.merchant_id = OLD.merchant_id AND NEW.conversation_id = OLD.conversation_id THEN
    NEW.id := OLD.id;
    NEW.processed_at := OLD.processed_at;
    NEW.last_listed_at := OLD.last_listed_at;
    NEW.attempts := OLD.attempts;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.id := pg_catalog.gen_random_uuid();
    NEW.processed_at := NULL;
    NEW.last_listed_at := NULL;
    NEW.attempts := 0;
    NEW.created_at := pg_catalog.now();
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_chat_follow_up_reminder() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS chat_follow_up_reminders_guard ON public.chat_follow_up_reminders;
CREATE TRIGGER chat_follow_up_reminders_guard
  BEFORE INSERT OR UPDATE ON public.chat_follow_up_reminders
  FOR EACH ROW EXECUTE FUNCTION private.guard_chat_follow_up_reminder();

COMMENT ON TABLE public.chat_follow_up_reminders IS
  'One pending push reminder per chat follow-up, recorded when the follow-up is set; swept by a cron that pushes it once.';

-- Set just before a push is handed to the delivery provider (follow-ups only),
-- so a sweep can tell a run that stopped before sending from one that may have
-- sent.
ALTER TABLE public.chat_message_events
  ADD COLUMN IF NOT EXISTS push_dispatch_started_at timestamptz;

-- A reminder is its own kind of chat event, next to messages and handovers.
ALTER TABLE public.chat_message_events DROP CONSTRAINT IF EXISTS chat_message_events_kind_check;
ALTER TABLE public.chat_message_events
  ADD CONSTRAINT chat_message_events_kind_check
  CHECK (kind IN ('message', 'handover', 'follow_up'));

COMMENT ON COLUMN public.chat_message_events.kind IS
  'message = a customer message, handover = the assistant handed the chat to a person, follow_up = a follow-up the team set came due.';

COMMIT;
