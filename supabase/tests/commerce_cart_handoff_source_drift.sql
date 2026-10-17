-- Each drift is syntactically valid but changes one required repair anchor.
-- Subtransactions restore all installed functions after every probe.
CREATE FUNCTION pg_temp.check_handoff_source_drift(repair text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE probe record; definition text; rejected boolean;
BEGIN
 FOR probe IN SELECT * FROM (VALUES
  ('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
   '    v_staged := v_staged || jsonb_build_object(',
   '    v_staged := v_staged  || jsonb_build_object(',
   'handoff canonical quantity source mismatch'),
  ('public.commerce_cart_redeem_handoff_coverage_impl(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb)',
   'least(now() + interval ''7 days'', v_incoming.expires_at));',
   'least(now() + interval ''7 days'',  v_incoming.expires_at));',
   'handoff new connect grant source mismatch'),
  ('public.commerce_cart_issue_handoff_device_impl(text,uuid,uuid,text,jsonb)',
   '  v_cart_found boolean;', '  v_cart_found  boolean;',
   'handoff issue declaration source mismatch'),
  ('public.commerce_cart_issue_handoff_device_impl(text,uuid,uuid,text,jsonb)',
   'p_operation_id, p_destination, now() + interval ''5 minutes'');',
   'p_operation_id, p_destination, now()  + interval ''5 minutes'');',
   'handoff issue deadline source mismatch'),
  ('public.commerce_cart_issue_handoff_device_impl(text,uuid,uuid,text,jsonb)',
   'to_char((now() + interval ''5 minutes'') AT TIME ZONE',
   'to_char((now()  + interval ''5 minutes'') AT TIME ZONE',
   'handoff issue receipt source mismatch')
 ) AS probes(signature,anchor,drift,expected_error) LOOP
  rejected:=false;
  definition:=pg_get_functiondef(probe.signature::regprocedure);
  IF position(probe.anchor IN definition)=0 THEN RAISE EXCEPTION 'drift fixture anchor absent: %',probe.expected_error; END IF;
  BEGIN
   EXECUTE replace(definition,probe.anchor,probe.drift);
   EXECUTE repair;
   RAISE EXCEPTION 'repair silently accepted source drift' USING ERRCODE='PZ001';
  EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE='P0001' AND SQLERRM=probe.expected_error THEN rejected:=true;
   ELSIF SQLSTATE<>'PZ001' THEN RAISE; END IF;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'source drift regression: %',probe.expected_error; END IF;
 END LOOP;
END $$;
