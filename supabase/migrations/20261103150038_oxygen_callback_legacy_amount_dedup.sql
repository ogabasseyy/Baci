-- Compatibility is limited to duplicate comparison. Never persist the old
-- inferred units for a newly accepted callback or change financial state.
CREATE FUNCTION oxygen_private.callback_legacy_minor(p_value jsonb)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_text text; v_value numeric;
BEGIN
 IF jsonb_typeof(p_value) NOT IN ('number','string') THEN RETURN NULL; END IF;
 v_text:=p_value #>> '{}';
 IF v_text !~ '^\d+(\.\d{1,2})?$' THEN RETURN NULL; END IF;
 v_value:=v_text::numeric*100;
 IF v_value>9007199254740991 OR v_value<>trunc(v_value) THEN RETURN NULL; END IF;
 RETURN v_value::bigint;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.callback_legacy_minor(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION oxygen_private.callback_legacy_amount_shape(p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v_result jsonb; v_loans jsonb; v_loan jsonb; v_converted jsonb; v_first bigint; v_second bigint;
BEGIN
 IF p_event->>'kind'='transaction' THEN
  IF p_event ?| ARRAY['amountDeductedMinor','amountSentMinor'] OR
   jsonb_typeof(p_event->'providerAmountDeducted') IS DISTINCT FROM 'string' OR
   jsonb_typeof(p_event->'providerAmountSent') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  v_first:=oxygen_private.callback_legacy_minor(p_event->'providerAmountDeducted');
  v_second:=oxygen_private.callback_legacy_minor(p_event->'providerAmountSent');
  IF v_first IS NULL OR v_second IS NULL THEN RETURN NULL; END IF;
  RETURN (p_event - ARRAY['providerAmountDeducted','providerAmountSent']) ||
   jsonb_build_object('amountDeductedMinor',v_first,'amountSentMinor',v_second);
 ELSIF p_event->>'kind'='settlement' THEN
  IF p_event ? 'amountMinor' OR jsonb_typeof(p_event->'providerAmount') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
  v_first:=oxygen_private.callback_legacy_minor(p_event->'providerAmount');
  v_loans:=p_event->'activationAudit'->'loans';
  IF v_first IS NULL OR jsonb_typeof(v_loans) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  v_converted:='[]'::jsonb;
  FOR v_loan IN SELECT value FROM jsonb_array_elements(v_loans) LOOP
   IF v_loan ?| ARRAY['principalMinor','equityMinor'] OR
    jsonb_typeof(v_loan->'providerLoanAmount') IS DISTINCT FROM 'number' OR
    jsonb_typeof(v_loan->'providerFirstRepayment') IS DISTINCT FROM 'number' THEN RETURN NULL; END IF;
   v_first:=oxygen_private.callback_legacy_minor(v_loan->'providerLoanAmount');
   v_second:=oxygen_private.callback_legacy_minor(v_loan->'providerFirstRepayment');
   IF v_first IS NULL OR v_second IS NULL THEN RETURN NULL; END IF;
   v_converted:=v_converted || jsonb_build_array((v_loan - ARRAY['providerLoanAmount','providerFirstRepayment']) ||
    jsonb_build_object('principalMinor',v_first,'equityMinor',v_second));
  END LOOP;
  v_result:=jsonb_set(p_event,'{activationAudit,loans}',v_converted);
  RETURN (v_result - 'providerAmount') || jsonb_build_object('amountMinor',oxygen_private.callback_legacy_minor(p_event->'providerAmount'));
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION oxygen_private.callback_legacy_amount_shape(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Compare both rollout directions only after the original insert collided in
-- the same partner/environment/key. A historic row cannot recover the textual
-- precision that the old normalization discarded; equality uses that historic
-- numeric representation and exact equality of every other normalized field.
DO $$
DECLARE definition text; needle text; replacement text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.callback(text,text,jsonb)'::regprocedure);
 needle:=$old$  IF v_existing<>v_hash THEN RAISE EXCEPTION 'Callback conflict' USING ERRCODE='22023'; END IF;$old$;
 replacement:=$new$  IF v_existing<>v_hash AND NOT (
   coalesce(v_existing=sha256(convert_to(oxygen_private.callback_legacy_amount_shape(p_payload)::text,'UTF8')),false)
   OR EXISTS (SELECT 1 FROM oxygen_private.callback_inbox prior
    WHERE prior.partner_reference=p_partner AND prior.environment=v_environment AND prior.deduplication_key=v_key
     AND coalesce(v_hash=sha256(convert_to(oxygen_private.callback_legacy_amount_shape(prior.event)::text,'UTF8')),false))
  ) THEN RAISE EXCEPTION 'Callback conflict' USING ERRCODE='22023'; END IF;$new$;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'Unexpected Oxygen callback duplicate definition';
 END IF;
 EXECUTE replace(definition,needle,replacement);
END $$;
NOTIFY pgrst,'reload schema';
