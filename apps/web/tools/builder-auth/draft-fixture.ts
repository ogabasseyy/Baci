/** Disposable SQL boundary fixture. Full schema replay remains a separate gate. */
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { databaseFixture } from './test-fixtures.ts';
export async function draftFixture(
  options: { cutover?: boolean; asyncEdits?: boolean } = {}
) {
  const fixture = await databaseFixture();
  try {
    await fixture.pool.query(`CREATE ROLE service_role BYPASSRLS;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claims',true)::jsonb $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt()->>'role' $$;
 GRANT EXECUTE ON FUNCTION auth.jwt(),auth.role() TO authenticated;
 ALTER TABLE merchants ALTER COLUMN id SET DEFAULT gen_random_uuid();
 ALTER TABLE merchants ADD CONSTRAINT merchants_user_id_key UNIQUE(user_id);
 ALTER TABLE merchants ADD COLUMN updated_at timestamptz DEFAULT now(), ADD COLUMN email text NOT NULL DEFAULT 'fixture@example.test', ADD COLUMN business_name text,ADD COLUMN business_type text,ADD COLUMN country text,ADD COLUMN slug text UNIQUE,ADD COLUMN template_id text,ADD COLUMN is_published boolean DEFAULT false,ADD COLUMN payout_currency text DEFAULT 'NGN',ADD COLUMN hero_image_ids text[],ADD COLUMN brand_colors jsonb,ADD COLUMN logo_url text,ADD COLUMN pages jsonb,ADD COLUMN site_title text,ADD COLUMN site_tagline text,ADD COLUMN site_description text;
 GRANT INSERT,UPDATE,DELETE ON merchants TO authenticated;
 ALTER TABLE merchants ADD COLUMN fixture_private_secret text;REVOKE SELECT ON merchants FROM authenticated;GRANT SELECT(id,user_id,email,business_name,business_type,country,slug,template_id,is_published,brand_colors,logo_url,hero_image_ids,payout_currency,pages,site_title,site_tagline,site_description,updated_at) ON merchants TO authenticated;
 CREATE TABLE page_configs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),page_slug text NOT NULL,page_name text NOT NULL,draft_config jsonb,published_config jsonb,is_published boolean DEFAULT false,updated_at timestamptz,created_at timestamptz DEFAULT now(),published_at timestamptz,draft_seo jsonb,published_seo jsonb,draft_store_settings jsonb,published_store_settings jsonb,draft_setup_settings jsonb,published_setup_settings jsonb,UNIQUE(merchant_id,page_slug));
 CREATE TABLE domains(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),domain text UNIQUE NOT NULL,tld text,domain_type text,status text,is_primary boolean);
 CREATE TABLE staff_members(id uuid PRIMARY KEY,merchant_id uuid,user_id uuid,status text,permissions jsonb);
 CREATE FUNCTION get_staff_permissions(p_id uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT permissions FROM public.staff_members WHERE id=p_id $$;
 CREATE TABLE page_config_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),page_config_id uuid REFERENCES page_configs(id),config jsonb,version_note text);
 CREATE TABLE ai_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid REFERENCES merchants(id),type text,status text,input jsonb,output jsonb,created_at timestamptz DEFAULT now(),metadata jsonb,result_applied_at timestamptz);
 CREATE FUNCTION update_merchant_identity_settings(p_merchant_id uuid,p_settings jsonb,p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE receipt jsonb; BEGIN IF NOT public.check_staff_permission(auth.uid(),p_merchant_id,'settings','edit') THEN RAISE EXCEPTION 'forbidden'; END IF; UPDATE public.merchants SET business_name=p_settings->>'business_name',updated_at=clock_timestamp() WHERE id=p_merchant_id AND updated_at=p_expected_updated_at RETURNING jsonb_build_object('id',id,'updated_at',updated_at) INTO receipt;RETURN receipt; END $$;

 CREATE FUNCTION is_reserved_merchant_slug(slug text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT slug IN('auth','mcp','admin','www') $$;
 `);
    const legacy = readFileSync(
      new URL(
        '../../../../supabase/migrations/20260707073000_normalize_and_propagate_merchant_business_name.sql',
        import.meta.url
      ),
      'utf8'
    );
    const transformStart = legacy.indexOf(
      'CREATE OR REPLACE FUNCTION public.rewrite_config_business_name('
    );
    await fixture.pool.query(
      legacy.slice(transformStart, legacy.indexOf('\n$$;', transformStart) + 4)
    );
    await fixture.pool.query(
      readFileSync(
        new URL(
          '../../../../supabase/migrations/20260705143000_align_staff_permission_all_grants.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await fixture.pool.query(`
 CREATE POLICY merchant_settings ON merchants TO authenticated USING(check_staff_permission(auth.uid(),id,'settings','edit')) WITH CHECK(check_staff_permission(auth.uid(),id,'settings','edit'));
 ALTER TABLE page_configs ENABLE ROW LEVEL SECURITY;ALTER TABLE domains ENABLE ROW LEVEL SECURITY;ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;ALTER TABLE page_config_history ENABLE ROW LEVEL SECURITY;
 CREATE POLICY page_read ON page_configs FOR SELECT USING(true);
 CREATE POLICY page_write ON page_configs TO authenticated USING(check_staff_permission(auth.uid(),merchant_id,'builder','edit')) WITH CHECK(check_staff_permission(auth.uid(),merchant_id,'builder','edit'));
 CREATE POLICY domain_owner ON domains TO authenticated USING(EXISTS(SELECT 1 FROM merchants WHERE id=merchant_id AND user_id=auth.uid()));
 CREATE POLICY history_owner ON page_config_history TO authenticated USING(EXISTS(SELECT 1 FROM page_configs p WHERE p.id=page_config_id AND check_staff_permission(auth.uid(),p.merchant_id,'builder','edit')));
 CREATE POLICY job_owner ON ai_jobs TO authenticated USING(check_staff_permission(auth.uid(),merchant_id,'builder','edit'));
 GRANT SELECT ON page_configs TO anon;GRANT SELECT,INSERT,UPDATE,DELETE ON page_configs,domains,ai_jobs,page_config_history TO authenticated;
 `);
    for (const migration of [
      '20261022071051_builder_private_draft_foundation.sql',
      '20261022071353_builder_private_draft_adapters.sql',
      '20261022071651_builder_draft_operations.sql',
      '20261022072221_builder_private_draft_contract.sql',
      ...(options.asyncEdits ? ['20261022103000_builder_async_edits.sql'] : []),
    ])
      await fixture.pool.query(
        readFileSync(
          new URL(
            `../../../../supabase/migrations/${migration}`,
            import.meta.url
          ),
          'utf8'
        )
      );
    if (options.cutover !== false) {
      const client = await fixture.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL baci.builder_private_cutover='approved'");
        await client.query(
          'CALL builder_authorization.cutover_private_drafts()'
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    }
    return fixture;
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
export async function asActor(
  client: PoolClient,
  actor: string,
  run: () => Promise<unknown>
) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({
        sub: actor,
        role: 'authenticated',
        email: 'fixture@example.test',
      }),
    ]);
    const result = await run();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
