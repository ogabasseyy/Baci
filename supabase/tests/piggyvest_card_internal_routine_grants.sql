DO $$
DECLARE
  routine regprocedure;
  capability name;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'piggyvest_primary_card.assert_scope(jsonb,boolean)'::regprocedure,
    'piggyvest_primary_card.assert_scope(jsonb,boolean,boolean)'::regprocedure,
    'piggyvest_primary_card.block_unsettled_customer_deletion()'::regprocedure
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) grant_entry
      WHERE p.oid = routine AND grant_entry.grantee = 0
        AND grant_entry.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Card internal routine still grants PUBLIC execution: %', routine;
    END IF;
    FOREACH capability IN ARRAY ARRAY[
      'primary_bank_signed_intake', 'primary_bank_inbox_worker',
      'primary_card_authorizer', 'primary_card_evidence', 'primary_card_custody_evidence'
    ]::name[] LOOP
      IF pg_catalog.has_function_privilege(capability, routine, 'EXECUTE') THEN
        RAISE EXCEPTION 'Capability % can execute card internal routine: %', capability, routine;
      END IF;
    END LOOP;
  END LOOP;
END $$;
