import assert from 'node:assert/strict';

/** Synthetic identity only. Full membership acceptance requires parent's replay. */
export function buildPrivatePolicyFixture({ read, owner, staff, merchant }) {
  const baseline = read('supabase/migrations/20260418000000_baseline.sql');
  const table = baseline.match(
    /CREATE TABLE IF NOT EXISTS "public"\."page_configs" \([\s\S]*?\n\);/
  )?.[0];
  assert(table, 'Baseline page_configs definition not found');
  const policies = read(
    'supabase/migrations/20260612061125_harden_access_helper_policies.sql'
  );
  const selectPolicies = policies.slice(
    policies.indexOf(
      'CREATE POLICY "Public can select published page configs"'
    ),
    policies.indexOf('DROP POLICY IF EXISTS "Staff can delete page configs"')
  );
  assert(selectPolicies.includes('Authenticated can select page configs'));
  // Only identity helpers are fixture implementations. The table and SELECT
  // policy bodies above are read directly from the repository migrations.
  return `
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE authenticator LOGIN NOINHERIT;
    GRANT anon, authenticated TO authenticator;
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE FUNCTION public.has_merchant_access(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT auth.uid() = '${owner}'::uuid
    $$;
    CREATE FUNCTION public.check_staff_permission(uuid,uuid,text,text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT $1 IN ('${owner}'::uuid,'${staff}'::uuid) AND $2 = '${merchant}'::uuid
    $$;
    CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid,business_name text);
    INSERT INTO public.merchants VALUES('${merchant}','${owner}','Fixture Shop');
    GRANT SELECT,UPDATE ON public.merchants TO authenticated;
    ${table}
    ALTER TABLE public.page_configs ADD PRIMARY KEY(id),ADD UNIQUE(merchant_id,page_slug);
    CREATE TABLE public.ai_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid,type text,status text,input jsonb,result_applied_at timestamptz,metadata jsonb);
    ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT,UPDATE ON public.ai_jobs TO authenticated;
    CREATE POLICY fixture_job_read ON public.ai_jobs FOR SELECT TO authenticated USING(public.check_staff_permission(auth.uid(),merchant_id,'builder','view'));
    CREATE POLICY fixture_job_insert ON public.ai_jobs FOR INSERT TO authenticated WITH CHECK(merchant_id IN(SELECT id FROM public.merchants WHERE user_id=auth.uid()));
    CREATE TABLE public.page_config_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),page_config_id uuid,config jsonb,version_note text);
    ALTER TABLE public.page_config_history ENABLE ROW LEVEL SECURITY;
    GRANT SELECT,INSERT ON public.page_config_history TO authenticated;
    CREATE POLICY fixture_history ON public.page_config_history TO authenticated USING(EXISTS(SELECT 1 FROM public.page_configs p WHERE p.id=page_config_id AND public.check_staff_permission(auth.uid(),p.merchant_id,'builder','edit')));
    ALTER TABLE public.page_configs ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.page_configs TO anon, authenticated;
    ${read('supabase/migrations/20260423103000_add_builder_page_config_seo_columns.sql')}
    ${selectPolicies}
    CREATE POLICY fixture_page_delete ON public.page_configs FOR DELETE TO authenticated USING(public.check_staff_permission(auth.uid(),merchant_id,'builder','edit'));
    CREATE POLICY fixture_page_insert ON public.page_configs FOR INSERT TO authenticated WITH CHECK(public.check_staff_permission(auth.uid(),merchant_id,'builder','edit'));
    CREATE POLICY fixture_page_update ON public.page_configs FOR UPDATE TO authenticated USING(public.check_staff_permission(auth.uid(),merchant_id,'builder','edit')) WITH CHECK(public.check_staff_permission(auth.uid(),merchant_id,'builder','edit'));
    ${read('supabase/migrations/20260707073000_normalize_and_propagate_merchant_business_name.sql')}
    ${read('apps/web/tools/builder-preview-spike/private-storage.sql')}
    INSERT INTO public.page_configs (id,merchant_id,page_slug,page_name,is_published,published_config,draft_config,draft_seo,draft_store_settings,draft_setup_settings)
    VALUES ('40000000-0000-4000-8000-000000000001','${merchant}','home','Home',true,
      '{"content":"PUBLIC"}','{"content":"PRIVATE-DRAFT"}',
      '{"title":"PRIVATE-SEO"}','{"value":"PRIVATE-STORE"}','{"value":"PRIVATE-SETUP"}');
  `;
}
