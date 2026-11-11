-- Let shared-cart receivers actually join their private channel.
--
-- Supabase Realtime decides whether a client may join a private channel by
-- inserting a probe row into realtime.messages (topic and extension only),
-- switching to the client's role and claims, and checking whether that row is
-- visible (realtime.authorize, and the equivalent transaction in older
-- Realtime builds). The probe never sets `private`, so the column takes its
-- default of false.
--
-- Both receiver SELECT policies required `private IS TRUE`. The probe row could
-- therefore never be visible, and every join was refused with "You do not have
-- permissions to read from this Channel topic". Browsers silently fell back to
-- the 15-second poll: change notices were sent, and nobody could receive them.
--
-- `private IS TRUE` added no protection. Row security on realtime.messages is
-- consulted only for private channels, the receiver role still sees nothing
-- outside its own `cart:<merchant>:<cart>` topic, and the grant, merchant
-- enrollment, expiry and receiver-only checks all stay in
-- commerce_cart_receiver_authorized. Send, update and delete stay denied by
-- the existing restrictive policies.
DROP POLICY IF EXISTS commerce_cart_receive_private ON realtime.messages;
CREATE POLICY commerce_cart_receive_private ON realtime.messages
 FOR SELECT TO commerce_cart_receiver
 USING (extension='broadcast'
   AND topic=(SELECT realtime.topic())
   AND public.commerce_cart_receiver_authorized((SELECT realtime.topic())));

-- Restrictive twin: constrains any inherited PUBLIC policy or grant, so a
-- legacy topic policy cannot widen the receiver's authority.
DROP POLICY IF EXISTS commerce_cart_receive_scope ON realtime.messages;
CREATE POLICY commerce_cart_receive_scope ON realtime.messages
 AS RESTRICTIVE FOR SELECT TO commerce_cart_receiver
 USING (extension='broadcast'
   AND topic=(SELECT realtime.topic())
   AND public.commerce_cart_receiver_authorized((SELECT realtime.topic())));
