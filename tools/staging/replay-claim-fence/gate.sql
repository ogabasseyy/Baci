  DECLARE
    baci_claim_fence_context pg_catalog.json;
  BEGIN
    BEGIN
      baci_claim_fence_context := NULLIF(
        pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.json;
      IF pg_catalog.json_typeof(baci_claim_fence_context) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Replay claimant refused';
      END IF;
      IF EXISTS (SELECT entry.key FROM pg_catalog.json_each(baci_claim_fence_context) entry
        GROUP BY entry.key HAVING count(*) <> 1)
        OR pg_catalog.json_typeof(baci_claim_fence_context->'role') IS DISTINCT FROM 'string'
        OR baci_claim_fence_context->>'role' IS DISTINCT FROM '__ROLE__'
        OR pg_catalog.json_typeof(baci_claim_fence_context->'aud') IS DISTINCT FROM 'string'
        OR baci_claim_fence_context->>'aud' IS DISTINCT FROM '__AUDIENCE__'
        OR pg_catalog.json_typeof(baci_claim_fence_context->'__CLAIM_KEY__') IS DISTINCT FROM 'string'
        OR baci_claim_fence_context->>'__CLAIM_KEY__' IS DISTINCT FROM '__GENERATION__'
        OR pg_catalog.json_typeof(baci_claim_fence_context->'exp') IS DISTINCT FROM 'number'
        OR baci_claim_fence_context->>'exp' IS DISTINCT FROM '__EXPIRY__'
        OR pg_catalog.clock_timestamp() >= '__DEADLINE__'::pg_catalog.timestamptz THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Replay claimant refused';
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Replay claimant refused';
    END;
  END;
