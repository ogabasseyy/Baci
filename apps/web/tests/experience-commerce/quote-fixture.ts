import { readFileSync } from 'node:fs';
import type { createCommerceEngineFixture } from './cart-engine-fixture';

const sql = (name: string) =>
  readFileSync(
    new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
    'utf8'
  );
/** Synthetic proof secret has no Supabase admin authority; never load a real key. */
export async function prepareQuoteAttestationFixture(
  f: Awaited<ReturnType<typeof createCommerceEngineFixture>>
) {
  const base = sql('20260418000000_baseline.sql');
  const table = base.slice(
    base.indexOf('CREATE TABLE IF NOT EXISTS "public"."shipping_quotes"'),
    base.indexOf('ALTER TABLE "public"."shipping_quotes" OWNER')
  );
  await f.pool.query(
    table +
      `;ALTER TABLE shipping_quotes ADD PRIMARY KEY(id);ALTER TABLE shipping_quotes ADD COLUMN merchant_id uuid REFERENCES merchants(id);ALTER TABLE shipping_quotes ENABLE ROW LEVEL SECURITY;CREATE SCHEMA IF NOT EXISTS extensions;CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;CREATE SCHEMA IF NOT EXISTS private;CREATE SCHEMA IF NOT EXISTS vault;CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);INSERT INTO vault.decrypted_secrets VALUES('service_role_key','local-disabled-no-admin-key');CREATE OR REPLACE FUNCTION public.has_merchant_access(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=p_id AND m.user_id=auth.uid()) $$;`
  );
  await f.pool.query(`DO $do$ BEGIN
 IF to_regprocedure('extensions.hmac(text,text,text)') IS NULL THEN EXECUTE $fn$ CREATE FUNCTION extensions.hmac(text,text,text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT AS 'SELECT public.hmac($1,$2,$3)' $fn$; END IF;
 IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN EXECUTE $fn$ CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT AS 'SELECT public.digest($1,$2)' $fn$; END IF;
 END $do$;`);
  await f.pool.query(sql('20260901190000_add_gigl_quote_economics.sql'));
  await f.pool.query(
    sql('20261024160001_attested_storefront_shipping_quotes.sql')
  );
}
