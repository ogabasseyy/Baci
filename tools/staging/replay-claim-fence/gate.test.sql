DO $test$
DECLARE
  rejected_context text;
  before_rows jsonb;
  before_probe jsonb;
  contexts text[] := ARRAY[
    '', '{}', 'not-json', '{', 'null', '[]', '42', 'true',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","exp":1791302350}',
    '{"role":"authenticated","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":1791302350}',
    '{"role":true,"aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":1791302350}',
    '{"role":"pvb_staging_worker","aud":"authenticated","replay_claimant_generation":"__GENERATION__","exp":1791302350}',
    '{"role":"pvb_staging_worker","aud":["pvb-staging-receipts"],"replay_claimant_generation":"__GENERATION__","exp":1791302350}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"40000000-0000-4000-8000-000000000002","exp":1791302350}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":null,"exp":1791302350}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":42,"exp":1791302350}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__"}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":"1791302350"}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":1791302350.0}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":1}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":1791302351}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":1e1000000}',
    '{"role":"pvb_staging_worker","role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","exp":1791302350}',
    '{"role":"pvb_staging_worker","aud":"pvb-staging-receipts","replay_claimant_generation":"__GENERATION__","replay_claimant_generation":"__GENERATION__","exp":1791302350}'
  ];
BEGIN
  SELECT jsonb_agg(to_jsonb(receipt) ORDER BY id) INTO before_rows
    FROM public.piggyvest_staging_receipts receipt;
  SELECT jsonb_build_object('last_value', last_value, 'is_called', is_called)
    INTO before_probe FROM public.claim_fence_mutation_probe;
  FOREACH rejected_context IN ARRAY contexts LOOP
    PERFORM set_config('request.jwt.claims', rejected_context, true);
    BEGIN
      PERFORM count(*) FROM public.claim_piggyvest_staging_receipts(10, 300);
      RAISE EXCEPTION 'unauthorized fixture accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM <> 'Replay claimant refused' THEN
        RAISE EXCEPTION 'unsanitized refusal';
      END IF;
    END;
    IF (SELECT jsonb_agg(to_jsonb(receipt) ORDER BY id)
      FROM public.piggyvest_staging_receipts receipt) IS DISTINCT FROM before_rows THEN
      RAISE EXCEPTION 'refusal changed receipt rows';
    END IF;
    IF (SELECT jsonb_build_object('last_value', last_value, 'is_called', is_called)
      FROM public.claim_fence_mutation_probe)
      IS DISTINCT FROM before_probe THEN
      RAISE EXCEPTION 'refusal executed a mutation before raising';
    END IF;
  END LOOP;
END;
$test$;
