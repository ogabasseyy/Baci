-- Private cart invalidations. No shopper INSERT permission on realtime.messages.
-- See https://supabase.com/docs/guides/realtime/authorization . RLS already
-- belongs to Realtime; do not ALTER its ownership or RLS enablement here.
CREATE OR REPLACE FUNCTION public.commerce_cart_receive_authorized(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.commerce_cart_grants g
  JOIN public.commerce_carts c ON c.id=g.cart_id AND c.merchant_id=g.merchant_id
  JOIN public.merchants m ON m.id=g.merchant_id
  WHERE g.id::text=auth.jwt()->>'cart_grant_id'
    AND g.cart_id::text=auth.jwt()->>'cart_id'
    AND g.merchant_id::text=auth.jwt()->>'cart_merchant_id'
    AND g.principal_id=auth.jwt()->>'cart_principal_id'
    AND auth.jwt()->>'cart_scope'='session'
    AND auth.jwt()->>'role' IN ('commerce_cart_shopper','commerce_cart_receiver')
    AND CASE WHEN auth.jwt()->>'exp' ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (auth.jwt()->>'exp')::numeric > extract(epoch FROM now()) ELSE false END
    AND g.revoked_at IS NULL AND g.expires_at>now() AND c.expires_at>now()
    AND c.state IN ('active','checkout')
    AND m.premium_features @> '["shared_cart","shared_cart_realtime"]'::jsonb
    AND p_topic='cart:'||g.merchant_id::text||':'||g.cart_id::text
 );
$$;
ALTER FUNCTION public.commerce_cart_receive_authorized(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_receive_authorized(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_receive_authorized(text) TO commerce_cart_shopper,commerce_cart_receiver;

GRANT USAGE ON SCHEMA realtime TO commerce_cart_receiver;
GRANT SELECT ON realtime.messages TO commerce_cart_receiver;
DROP POLICY IF EXISTS commerce_cart_receive_private ON realtime.messages;
CREATE POLICY commerce_cart_receive_private ON realtime.messages FOR SELECT TO commerce_cart_receiver
 USING (extension='broadcast' AND private IS TRUE
   AND topic=(SELECT realtime.topic())
   AND public.commerce_cart_receive_authorized((SELECT realtime.topic())));

-- Restrictive policies also constrain any inherited PUBLIC policy/grant. A
-- permissive receiver policy alone would be widened by legacy topic policies.
DROP POLICY IF EXISTS commerce_cart_receive_scope ON realtime.messages;
CREATE POLICY commerce_cart_receive_scope ON realtime.messages AS RESTRICTIVE FOR SELECT TO commerce_cart_receiver
 USING (extension='broadcast' AND private IS TRUE AND topic=(SELECT realtime.topic())
   AND public.commerce_cart_receive_authorized((SELECT realtime.topic())));
DROP POLICY IF EXISTS commerce_cart_receive_no_send ON realtime.messages;
CREATE POLICY commerce_cart_receive_no_send ON realtime.messages AS RESTRICTIVE FOR INSERT TO commerce_cart_receiver WITH CHECK (false);
DROP POLICY IF EXISTS commerce_cart_receive_no_update ON realtime.messages;
CREATE POLICY commerce_cart_receive_no_update ON realtime.messages AS RESTRICTIVE FOR UPDATE TO commerce_cart_receiver USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS commerce_cart_receive_no_delete ON realtime.messages;
CREATE POLICY commerce_cart_receive_no_delete ON realtime.messages AS RESTRICTIVE FOR DELETE TO commerce_cart_receiver USING (false);
DROP POLICY IF EXISTS commerce_cart_no_direct_messages ON realtime.messages;
CREATE POLICY commerce_cart_no_direct_messages ON realtime.messages AS RESTRICTIVE FOR ALL TO commerce_cart_shopper,commerce_cart_worker USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.commerce_cart_realtime_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_topic text; v_expiry timestamptz;
BEGIN
 v_topic:='cart:'||(auth.jwt()->>'cart_merchant_id')||':'||(auth.jwt()->>'cart_id');
 IF NOT public.commerce_cart_receive_authorized(v_topic) THEN RETURN jsonb_build_object('ok',false); END IF;
 SELECT least(g.expires_at,c.expires_at,to_timestamp((auth.jwt()->>'exp')::double precision))
 INTO v_expiry FROM public.commerce_cart_grants g JOIN public.commerce_carts c ON c.id=g.cart_id AND c.merchant_id=g.merchant_id
 WHERE g.id::text=auth.jwt()->>'cart_grant_id';
 RETURN jsonb_build_object('ok',true,'topic',v_topic,'expiresAt',v_expiry);
END;
$$;
ALTER FUNCTION public.commerce_cart_realtime_access() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_realtime_access() FROM PUBLIC,anon,authenticated,commerce_cart_receiver;
GRANT EXECUTE ON FUNCTION public.commerce_cart_realtime_access() TO commerce_cart_shopper;

ALTER TABLE public.commerce_cart_events ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.commerce_cart_events ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz;
CREATE INDEX IF NOT EXISTS commerce_cart_events_ready_idx ON public.commerce_cart_events(next_attempt_at,id)
 WHERE delivered_at IS NULL AND dead_letter_at IS NULL;

-- Sending and acknowledgement share one database transaction. Row locks act
-- as transaction leases: process/connection death rolls both back. No external
-- HTTP call runs while holding a cart lock. Multiple scheduler instances can
-- claim disjoint rows with SKIP LOCKED, and retries remain harmless.
CREATE OR REPLACE FUNCTION public.commerce_cart_publish_events(p_limit integer,p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v_payload jsonb; v_topic text; v_sent integer:=0; v_failed integer:=0; v_dead integer:=0; v_attempt integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>50 OR p_worker_id IS NULL OR p_worker_id !~ '^[a-zA-Z0-9_-]{1,80}$' THEN
  RAISE EXCEPTION 'invalid publisher parameters';
 END IF;
 FOR r IN SELECT e.* FROM public.commerce_cart_events e JOIN public.merchants m ON m.id=e.merchant_id
  WHERE e.delivered_at IS NULL AND e.dead_letter_at IS NULL AND e.next_attempt_at<=now() AND e.expires_at>now()
   AND m.premium_features @> '["shared_cart","shared_cart_realtime"]'::jsonb
  ORDER BY e.id LIMIT p_limit FOR UPDATE OF e SKIP LOCKED
 LOOP
  v_payload:=jsonb_build_object('merchantId',r.merchant_id,'cartId',r.cart_id,'version',r.version,'operationId',r.operation_id);
  v_topic:='cart:'||r.merchant_id::text||':'||r.cart_id::text;
  v_attempt:=r.attempts+1;
  BEGIN
   UPDATE public.commerce_cart_events SET locked_at=now(),locked_by=p_worker_id,attempts=v_attempt WHERE id=r.id;
   PERFORM realtime.send(v_payload,'cart_changed',v_topic,true);
   -- realtime.send can report a warning instead of throwing when the daily
   -- partition is absent. Never acknowledge without a durable matching row.
   IF NOT EXISTS(SELECT 1 FROM realtime.messages WHERE topic=v_topic AND event='cart_changed' AND payload=v_payload AND private IS TRUE) THEN
    RAISE EXCEPTION 'broadcast not durably accepted';
   END IF;
   UPDATE public.commerce_cart_events SET delivered_at=now(),locked_at=NULL,locked_by=NULL WHERE id=r.id;
   v_sent:=v_sent+1;
  EXCEPTION WHEN OTHERS THEN
   UPDATE public.commerce_cart_events SET attempts=v_attempt,locked_at=NULL,locked_by=NULL,
    next_attempt_at=now()+make_interval(secs=>least(300,power(2,least(v_attempt,8))::integer)),
    dead_letter_at=CASE WHEN v_attempt>=10 THEN now() ELSE NULL END WHERE id=r.id;
   v_failed:=v_failed+1;
   IF v_attempt>=10 THEN v_dead:=v_dead+1; END IF;
  END;
 END LOOP;
 RETURN jsonb_build_object('sent',v_sent,'failed',v_failed,'deadLettered',v_dead);
END;
$$;
ALTER FUNCTION public.commerce_cart_publish_events(integer,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_publish_events(integer,text) FROM PUBLIC,anon,authenticated,commerce_cart_shopper,commerce_cart_receiver;
GRANT EXECUTE ON FUNCTION public.commerce_cart_publish_events(integer,text) TO commerce_cart_worker;

-- PostgREST's authenticator must be able to assume each dedicated JWT role.
-- Membership is not granted to anon/authenticated or to shopper principals.
GRANT commerce_cart_shopper, commerce_cart_receiver, commerce_cart_worker TO authenticator;
