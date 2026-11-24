-- Follow-up reminder pushes (part 1 of 3: the table, its row-level security and
-- the new event kind; part 2 is the sweep functions, part 3 the push log wording).
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

-- One pending reminder per chat. Setting another follow-up on the same chat
-- replaces the row under a NEW id (the id is the reminder's identity, and
-- keys its push event), so a replaced reminder can never be sent by a sweep
-- that listed it earlier.
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
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  -- Also the index on merchant_id for the foreign key.
  CONSTRAINT chat_follow_up_reminders_chat_key UNIQUE (merchant_id, conversation_id)
);

-- The sweep only looks at reminders nobody has handled yet.
CREATE INDEX IF NOT EXISTS chat_follow_up_reminders_due_idx
  ON public.chat_follow_up_reminders (due_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.chat_follow_up_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_follow_up_reminders FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_follow_up_reminders TO authenticated;

-- The store owner and staff may see reminders with the inbox "view" permission
-- and change them with the inbox "edit" permission: the same permissions the
-- inbox API itself asks for. check_staff_permission answers for the signed-in
-- caller only (and recognises the owner), and is used instead of an inline
-- merchants/staff_members subquery so the policy cannot recurse.
DROP POLICY IF EXISTS chat_follow_up_reminders_select ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_select ON public.chat_follow_up_reminders
  FOR SELECT TO authenticated
  USING (public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'view'));
DROP POLICY IF EXISTS chat_follow_up_reminders_insert ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_insert ON public.chat_follow_up_reminders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit')
    AND due_at <= pg_catalog.now() + interval '91 days'
  );
DROP POLICY IF EXISTS chat_follow_up_reminders_update ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_update ON public.chat_follow_up_reminders
  FOR UPDATE TO authenticated
  USING (public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit'))
  WITH CHECK (
    public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit')
    AND due_at <= pg_catalog.now() + interval '91 days'
  );
DROP POLICY IF EXISTS chat_follow_up_reminders_delete ON public.chat_follow_up_reminders;
CREATE POLICY chat_follow_up_reminders_delete ON public.chat_follow_up_reminders
  FOR DELETE TO authenticated
  USING (public.check_staff_permission((SELECT auth.uid()), merchant_id, 'customers', 'edit'));

COMMENT ON TABLE public.chat_follow_up_reminders IS
  'One pending push reminder per chat follow-up, recorded when the follow-up is set; swept by a cron that pushes it once.';

-- A reminder is its own kind of chat event, next to messages and handovers.
ALTER TABLE public.chat_message_events DROP CONSTRAINT IF EXISTS chat_message_events_kind_check;
ALTER TABLE public.chat_message_events
  ADD CONSTRAINT chat_message_events_kind_check
  CHECK (kind IN ('message', 'handover', 'follow_up'));

COMMENT ON COLUMN public.chat_message_events.kind IS
  'message = a customer message, handover = the assistant handed the chat to a person, follow_up = a follow-up the team set came due.';

COMMIT;
