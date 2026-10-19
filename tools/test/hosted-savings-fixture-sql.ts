import { hostedSavingsFixtureContract } from './hosted-savings-fixture-contract';
import { hostedSavingsInstallSql } from './hosted-savings-install-sql';

export function buildHostedSavingsFixtureSql(
  input: unknown,
  journal: readonly (readonly [number, string, string])[],
  apply = false
) {
  const reviewed = hostedSavingsFixtureContract.parse(input);
  if (
    journal.length !== reviewed.installed.completed ||
    journal.some(
      (entry, index) =>
        entry[0] !== index + 1 ||
        !/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(entry[1]) ||
        !/^[a-f0-9]{64}$/.test(entry[2])
    )
  )
    throw new Error('Fixture journal invalid');
  const { ownerId, customerActorId, systemIdentifier } = reviewed;
  const snapshot = (name: string) =>
    hostedSavingsInstallSql.snapshot
      .replaceAll('install_auth_snapshot', name)
      .replace(`SELECT value::text FROM ${name};`, '');
  return `BEGIN;
${hostedSavingsInstallSql.maintenance}
LOCK TABLE public.merchants, public.customers, public.products, public.product_variants, public.merchant_feature_settings IN ACCESS EXCLUSIVE MODE;
DO $boundary$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) <> '${systemIdentifier}'
 OR current_setting('session_replication_role') <> 'origin' THEN RAISE EXCEPTION 'Fixture identity denied' USING ERRCODE='P7301'; END IF;
 IF (SELECT COALESCE(jsonb_agg(jsonb_build_array(ordinal,source,sha256) ORDER BY ordinal),'[]') FROM hosted_savings_install_private.journal)
 IS DISTINCT FROM '${JSON.stringify(journal)}'::jsonb THEN RAISE EXCEPTION 'Installed journal mismatch' USING ERRCODE='P7302'; END IF;
 IF (SELECT count(*) FROM auth.users) <> 2
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${ownerId}' AND email='owner@savings.example.invalid')
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${customerActorId}' AND email='customer@savings.example.invalid')
 THEN RAISE EXCEPTION 'Official synthetic Auth accounts required' USING ERRCODE='P7303'; END IF;
 IF EXISTS(SELECT 1 FROM public.merchants) OR EXISTS(SELECT 1 FROM public.customers)
 OR EXISTS(SELECT 1 FROM public.products) OR EXISTS(SELECT 1 FROM public.product_variants)
 OR EXISTS(SELECT 1 FROM public.merchant_feature_settings) OR EXISTS(SELECT 1 FROM public.customer_wallets)
 OR EXISTS(SELECT 1 FROM public.merchant_wallets) OR EXISTS(SELECT 1 FROM public.customer_savings_goals)
 OR EXISTS(SELECT 1 FROM public.customer_savings_drafts) OR EXISTS(SELECT 1 FROM savings_draft_private.settings)
 OR EXISTS(SELECT 1 FROM savings_draft_private.canonical_creation_scopes)
 OR EXISTS(SELECT 1 FROM piggyvest_staging.integrations) OR EXISTS(SELECT 1 FROM piggyvest_staging.provisioning_integrations)
 THEN RAISE EXCEPTION 'Fixture collision or existing finance scope' USING ERRCODE='P7304'; END IF;
 IF EXISTS(SELECT 1 FROM net.http_request_queue) THEN RAISE EXCEPTION 'Pending external requests' USING ERRCODE='P7305'; END IF;
END $boundary$;
${snapshot('fixture_auth_before')}
SELECT set_config('request.jwt.claims','{"sub":"${ownerId}","role":"authenticated"}',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug,is_published,template_id)
VALUES('10000000-0000-4000-8000-000000000001','${ownerId}','owner@savings.example.invalid','Synthetic staging shop','savings-synthetic',true,'ogabassey');
INSERT INTO public.customers(id,user_id,merchant_id,email,first_name,last_name)
VALUES('10000000-0000-4000-8000-000000000002','${customerActorId}','10000000-0000-4000-8000-000000000001','customer@savings.example.invalid','Synthetic','Customer');
DO $flags$ DECLARE assignments text; changed integer; BEGIN
 SELECT string_agg(format('%I=false',attname),',') INTO assignments FROM pg_attribute
 WHERE attrelid='public.merchant_feature_settings'::regclass AND attnum>0 AND NOT attisdropped AND atttypid='boolean'::regtype;
 IF assignments IS NULL THEN RAISE EXCEPTION 'Feature flags unavailable' USING ERRCODE='P7306'; END IF;
 EXECUTE 'UPDATE public.merchant_feature_settings SET '||assignments||' WHERE merchant_id=''10000000-0000-4000-8000-000000000001''';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Expected trigger-created feature row' USING ERRCODE='P7306'; END IF;
END $flags$;
INSERT INTO public.products(id,merchant_id,name,slug,price,status,has_variants,images,stock,stock_quantity)
VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Synthetic phone','synthetic-phone',250000,'active',true,'[]',10,10);
INSERT INTO public.product_variants(id,merchant_id,product_id,attributes,price_override,stock_quantity)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','{"storage":"256GB","color":"Black"}',250000,5),
('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','{"storage":"512GB","color":"Blue"}',320000,5);
${snapshot('fixture_auth_after')}
DO $preserve$ BEGIN
 IF (SELECT value FROM fixture_auth_before) IS DISTINCT FROM (SELECT value FROM fixture_auth_after)
 OR EXISTS(SELECT 1 FROM public.customer_wallets) OR EXISTS(SELECT 1 FROM public.merchant_wallets)
 OR EXISTS(SELECT 1 FROM public.customer_savings_goals) OR EXISTS(SELECT 1 FROM public.customer_savings_drafts)
 OR EXISTS(SELECT 1 FROM savings_draft_private.settings) OR EXISTS(SELECT 1 FROM savings_draft_private.canonical_creation_scopes)
 OR EXISTS(SELECT 1 FROM net.http_request_queue)
 OR EXISTS(SELECT 1 FROM piggyvest_staging.integrations) OR EXISTS(SELECT 1 FROM piggyvest_staging.provisioning_integrations)
 THEN RAISE EXCEPTION 'Fixture preservation failed' USING ERRCODE='P7307'; END IF;
 IF (SELECT count(*) FROM public.merchants)<>1 OR (SELECT count(*) FROM public.customers)<>1
 OR (SELECT count(*) FROM public.products)<>1 OR (SELECT count(*) FROM public.product_variants)<>2
 OR (SELECT count(*) FROM public.merchant_feature_settings)<>1
 OR EXISTS(SELECT 1 FROM public.merchant_feature_settings flags CROSS JOIN LATERAL jsonb_each(to_jsonb(flags)) entry WHERE entry.value='true'::jsonb)
 THEN RAISE EXCEPTION 'Fixture rows or disabled flags mismatch' USING ERRCODE='P7308'; END IF;
END $preserve$;
${hostedSavingsInstallSql.maintenance}
${apply ? 'COMMIT' : 'ROLLBACK'};`;
}
