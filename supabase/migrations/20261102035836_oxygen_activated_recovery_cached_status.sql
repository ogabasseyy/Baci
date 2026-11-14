-- Activated checkout may read its canonical confirmation without requesting a
-- provider action. All owner, tenant, environment and order checks remain.
DO $$ DECLARE definition text; needle text;
BEGIN
 definition:=pg_get_functiondef('oxygen_private.payment_recovery_access(text,uuid,jsonb)'::regprocedure);
 needle:='OR w.stage=''activated''';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected recovery stage guard'; END IF;
 definition:=replace(definition,needle,'OR (w.stage=''activated'' AND p_operation<>''status'')');
 needle:='  v_status:=coalesce(v_status,jsonb_build_object(''paymentComplete'',provider->''paymentComplete'',''setupComplete'',provider->''setupComplete''));';
 IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Unexpected recovery status projection'; END IF;
 definition:=replace(definition,needle,$replacement$
  IF w.stage='activated' THEN
   -- Canonical activation must bind the same booking and both confirmed facts.
   IF provider->'booking'->>'status' IS DISTINCT FROM 'ACTIVATED'
    OR provider->'booking'->>'loan_reference' IS DISTINCT FROM current_ref::text
    OR provider->'paymentComplete' IS DISTINCT FROM 'true'::jsonb
    OR provider->'setupComplete' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='40001'; END IF;
   v_status:=jsonb_build_object('paymentComplete',true,'setupComplete',true);
  ELSE
   v_status:=coalesce(v_status,jsonb_build_object('paymentComplete',provider->'paymentComplete','setupComplete',provider->'setupComplete'));
  END IF;$replacement$);
 EXECUTE definition;
END $$;
NOTIFY pgrst,'reload schema';
