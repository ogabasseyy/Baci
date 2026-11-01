-- Included in the review-hold transaction after the scope fixtures exist.
DO $$
DECLARE principal text; routine regprocedure;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'piggyvest_primary.resolve_onboarding_routing(jsonb,jsonb,boolean,text)'::regprocedure,
    'piggyvest_primary.record_onboarding_review(jsonb,uuid,uuid,text,text,text)'::regprocedure
  ] LOOP
    FOREACH principal IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      PERFORM pg_temp.check(NOT has_function_privilege(principal, routine, 'EXECUTE'),
        principal || ' can execute classified review ' || routine::text);
    END LOOP;
    PERFORM pg_temp.check(has_function_privilege('piggyvest_primary_provisioner', routine, 'EXECUTE'),
      'provisioner cannot execute classified review ' || routine::text);
  END LOOP;
END $$;
