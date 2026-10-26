import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('X token RPC retains write-only tenant isolation and exclusive authentication', () => {
 const bin=process.env.PG_BIN ?? execFileSync('pg_config', ['--bindir'], {encoding:'utf8'}).trim();
 const directory=mkdtempSync(join(tmpdir(),'baci-x-token-'));
 const port='65451';
 const run=(command,args)=>execFileSync(join(bin,command),args,{encoding:'utf8',stdio:'pipe'});
 let started=false;
 try {
  run('initdb',['-D',`${directory}/data`,'-A','trust','--no-locale','-U','postgres']);
  run('pg_ctl',['-D',`${directory}/data`,'-l',`${directory}/postgres.log`,'-o',`-k ${directory} -p ${port} -c listen_addresses=''`,'-w','start']); started=true;
  const query=sql=>execFileSync(join(bin,'psql'),['-X','-v','ON_ERROR_STOP=1','-h',directory,'-p',port,'-U','postgres','-d','postgres','-qAt'],{input:sql,encoding:'utf8',stdio:'pipe'});
  query(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid NOT NULL);
   CREATE TABLE public.merchant_feature_settings(merchant_id uuid PRIMARY KEY,twitter_pixel_id text,updated_at timestamptz DEFAULT now());
   GRANT USAGE ON SCHEMA auth TO authenticated;GRANT SELECT ON public.merchants TO authenticated;GRANT ALL ON public.merchant_feature_settings TO authenticated;`);
  const baseline=readFileSync(new URL('../../supabase/migrations/20261026060604_x_ads_conversion_settings_and_destination.sql',import.meta.url),'utf8');
  query(baseline.split('ALTER TABLE public.event_deliveries')[0]+'COMMIT;');
  query(readFileSync(new URL('../../supabase/migrations/20261026095122_x_ads_pixel_token_authentication.sql',import.meta.url),'utf8'));
  const result=query(readFileSync(new URL('../../supabase/migrations/tests/x_ads_pixel_token_authentication.sql',import.meta.url),'utf8'));
  assert.match(result,/x_pixel_token_contract_passed/);
 } finally {
  if(started)run('pg_ctl',['-D',`${directory}/data`,'-m','immediate','-w','stop']);
  rmSync(directory,{recursive:true,force:true});
 }
});
