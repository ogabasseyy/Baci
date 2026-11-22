-- Bound preview storage even when invoked via PostgREST instead of the app.
CREATE FUNCTION private.limit_paid_order_amendment_preview()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT public.check_rate_limit(NEW.actor_id::text,'order_amendment_preview_rpc',30,1) THEN
    RAISE EXCEPTION 'amendment_rate_limited';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.limit_paid_order_amendment_preview() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER limit_paid_order_amendment_preview
  BEFORE INSERT ON private.paid_order_amendment_previews FOR EACH ROW
  EXECUTE FUNCTION private.limit_paid_order_amendment_preview();
