-- updated_at is the platform-cart compare-and-swap token. Every writer,
-- including legacy writers, must advance it even within one clock tick.
CREATE FUNCTION public.agentic_cart_advance_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 NEW.updated_at := greatest(pg_catalog.clock_timestamp(), OLD.updated_at + interval '1 microsecond');
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.agentic_cart_advance_revision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER agentic_cart_sessions_revision_trg
 BEFORE UPDATE ON public.agentic_cart_sessions
 FOR EACH ROW EXECUTE FUNCTION public.agentic_cart_advance_revision();
