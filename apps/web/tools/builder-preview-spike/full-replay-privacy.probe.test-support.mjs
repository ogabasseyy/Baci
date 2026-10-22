/** Run only against a retained, ownership-recorded disposable history replay. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { runFullProvisioningChecks } from './full-provisioning-checks.test-support.mjs';
import { runPrivateLifecycleChecks } from './private-lifecycle-checks.mjs';

const suppliedWorkdir = process.env.BACI_TASK0_REPLAY_WORKDIR;
const workdir = suppliedWorkdir ? realpathSync(suppliedWorkdir) : undefined;
assert(
  workdir && path.basename(workdir).startsWith('baci-supabase-replay-'),
  'An owned disposable replay workdir is required'
);
const ownership = JSON.parse(
  readFileSync(path.join(workdir, '.baci-supabase-replay-owner.json'), 'utf8')
);
assert.equal(ownership.workdir, workdir);
assert.match(ownership.projectId, /^baci_replay_[a-f0-9]{24}$/);
const db = `supabase_db_${ownership.projectId}`;
const network = `supabase_network_${ownership.projectId}`;
const api = `builder-full-api-${randomUUID()}`;
const root = new URL('../../../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
assert.equal(
  docker(
    'inspect',
    '--format',
    '{{ index .Config.Labels "com.supabase.cli.project" }}',
    db
  ),
  ownership.projectId
);
const sql = (input) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      db,
      'psql',
      '-U',
      'postgres',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 }
  );
assert.equal(sql('SHOW server_version_num').trim(), '170006');
const owner = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const staff = '20000000-0000-4000-8000-000000000003';
const viewer = '20000000-0000-4000-8000-000000000004';
const sales = '20000000-0000-4000-8000-000000000005';
const suspended = '20000000-0000-4000-8000-000000000006';
const merchant = '10000000-0000-4000-8000-000000000001';
const secret =
  'task0-full-replay-only-jwt-signing-material-not-a-real-credential';
const password = randomUUID();
const loginRole = `task0_api_${randomUUID().replaceAll('-', '')}`;
const records = [];
const productionSources = process.env.BACI_BUILDER_LIFECYCLE_SOURCES === '1';
const resume = process.env.BACI_TASK0_REPLAY_RESUME === '1';
if (resume) {
  assert.equal(
    sql(
      "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='page_configs' AND column_name='draft_config'"
    ).trim(),
    '0'
  );
}
async function check(name, run) {
  await run();
  records.push({ name, result: 'PASS' });
}
function token(sub) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'authenticated', sub, email: `task4-${sub}@example.test`, exp: Math.floor(Date.now() / 1000) + 900 })}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function cleanup() {
  try {
    docker('rm', '-f', api);
  } catch {
    /* own API only; parent owns replay cleanup */
  }
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    cleanup();
    process.exit(143);
  });
try {
  // Bootstrap synthetic accounts as local setup only. Suppress seed-time external
  // welcome triggers; all tested operations below run with ordinary triggers/RLS.
  sql(`BEGIN; SET LOCAL session_replication_role=replica;
 ${
   resume
     ? `DELETE FROM public.page_config_history WHERE page_config_id IN (SELECT id FROM public.page_configs WHERE merchant_id='${merchant}');
 DELETE FROM public.ai_jobs WHERE merchant_id='${merchant}';
 DELETE FROM public.builder_page_drafts WHERE merchant_id='${merchant}';
 DELETE FROM public.page_configs WHERE merchant_id='${merchant}';
 DELETE FROM public.staff_members WHERE merchant_id='${merchant}';
 UPDATE public.merchants SET business_name='Fixture Shop' WHERE id='${merchant}';`
     : ''
}
 INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
 ${[owner, other, staff, viewer, sales, suspended].map((id, i) => `('${id}','authenticated','authenticated','task0-${i}@example.test',now(),now())`).join(',')} ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.merchants(id,user_id,email,business_name,business_type,slug)
 VALUES('${merchant}','${owner}','task0-owner@example.test','Fixture Shop','electronics','task-zero-fixture') ON CONFLICT(id) DO NOTHING;
 INSERT INTO public.staff_members(merchant_id,user_id,email,role,status,permissions) VALUES
 ('${merchant}','${staff}','task0-staff@example.test','sales_rep','active','{"builder":{"view":true,"edit":true}}'),
 ('${merchant}','${viewer}','task0-viewer@example.test','sales_rep','active','{"builder":{"view":true,"edit":false}}'),
 ('${merchant}','${sales}','task0-sales@example.test','sales_rep','active','{"builder":{"view":false,"edit":false}}'),
 ('${merchant}','${suspended}','task0-suspended@example.test','sales_rep','suspended','{"builder":{"view":true,"edit":true}}') ON CONFLICT DO NOTHING;
 ${
   resume
     ? `INSERT INTO public.page_configs(id,merchant_id,page_slug,page_name,is_published,published_config)
 VALUES('40000000-0000-4000-8000-000000000001','${merchant}','home','Home',true,'{"content":"PUBLIC"}');
 INSERT INTO public.builder_page_drafts(id,merchant_id,draft_config,draft_seo,draft_store_settings,draft_setup_settings)
 VALUES('40000000-0000-4000-8000-000000000001','${merchant}','{"content":"PRIVATE-DRAFT"}','{"title":"PRIVATE-SEO"}','{"value":"PRIVATE-STORE"}','{"value":"PRIVATE-SETUP"}');`
     : `INSERT INTO public.page_configs(id,merchant_id,page_slug,page_name,is_published,published_config,draft_config,draft_seo,draft_store_settings,draft_setup_settings)
 VALUES('40000000-0000-4000-8000-000000000001','${merchant}','home','Home',true,'{"content":"PUBLIC"}','{"content":"PRIVATE-DRAFT"}','{"title":"PRIVATE-SEO"}','{"value":"PRIVATE-STORE"}','{"value":"PRIVATE-SETUP"}') ON CONFLICT(id) DO NOTHING;`
}
 COMMIT;
 CREATE ROLE ${loginRole} LOGIN NOINHERIT PASSWORD '${password}';
 GRANT anon,authenticated TO ${loginRole};`);
  docker(
    'run',
    '--rm',
    '-d',
    '--name',
    api,
    '--network',
    network,
    '-p',
    '127.0.0.1::3000',
    '-e',
    `PGRST_DB_URI=postgres://${loginRole}:${password}@${db}:5432/postgres`,
    '-e',
    'PGRST_DB_ANON_ROLE=anon',
    '-e',
    'PGRST_DB_SCHEMAS=public',
    '-e',
    `PGRST_JWT_SECRET=${secret}`,
    'public.ecr.aws/supabase/postgrest@sha256:85258123312dc496ad4c2ed832154a65e9746f84df0d6d09b44229ff9230c08e'
  );
  const address = docker('port', api, '3000/tcp');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  async function request(endpoint, user, options = {}) {
    const r = await fetch(`http://${address}/${endpoint}`, {
      signal: AbortSignal.timeout(10000),
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
        ...options.headers,
      },
    });
    const raw = await r.text();
    return { status: r.status, body: raw ? JSON.parse(raw) : null };
  }
  for (let i = 0; i < 40; i++) {
    try {
      if (
        (await request('page_configs?select=published_config')).status === 200
      )
        break;
    } catch {
      /* local API startup retry */
    }
    await setTimeout(250);
  }
  if (!resume) {
    for (const [name, user] of [
      ['anon', undefined],
      ['unrelated', other],
    ])
      await check(
        `full history raw draft exposure before split: ${name}`,
        async () => {
          const r = await request(
            'page_configs?select=draft_config,draft_seo',
            user
          );
          assert.equal(r.status, 200, JSON.stringify(r));
          assert.equal(r.body[0].draft_config.content, 'PRIVATE-DRAFT');
        }
      );
    if (productionSources) {
      const sources = [
        '20261022062133_builder_oauth_connections.sql',
        '20261022071051_builder_private_draft_foundation.sql',
        '20261022071353_builder_private_draft_adapters.sql',
        '20261022071651_builder_draft_operations.sql',
        '20261022072221_builder_private_draft_contract.sql',
      ];
      sql(
        `BEGIN; SET LOCAL baci.builder_private_cutover='approved';\n${sources.map((name) => read(`supabase/migrations/${name}`)).join('\n')}\nCALL builder_authorization.cutover_private_drafts();\nCOMMIT;`
      );
    } else
      sql(
        `BEGIN;\n${read('apps/web/tools/builder-preview-spike/private-storage.sql')}\n${read(
          'apps/web/tools/builder-preview-spike/private-split.sql'
        )
          .replace(/^BEGIN;$/m, '')
          .replace(
            /^COMMIT;$/m,
            ''
          )}\n${read('apps/web/tools/builder-preview-spike/private-lifecycle.sql')}\nCOMMIT;`
      );
  }
  sql("NOTIFY pgrst,'reload schema';");
  for (let i = 0; i < 40; i++) {
    const r = await request('builder_page_drafts?select=id', owner);
    if (r.status === 200) break;
    await setTimeout(250);
  }
  await check(
    'full history denies private-table grants to service role',
    () => {
      assert.equal(
        sql(
          "SELECT NOT(has_table_privilege('service_role','public.builder_page_drafts','SELECT') OR has_table_privilege('service_role','public.builder_page_drafts','INSERT') OR has_table_privilege('service_role','public.builder_page_drafts','UPDATE') OR has_table_privilege('service_role','public.builder_page_drafts','DELETE')); "
        ).trim(),
        't'
      );
      assert.equal(
        sql(
          "SELECT NOT has_function_privilege('service_role','public.apply_ai_storefront_draft(uuid,uuid,text,jsonb,timestamptz,boolean)','EXECUTE');"
        ).trim(),
        't'
      );
      assert.equal(
        sql(
          "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'builder_private_%' OR proname='apply_ai_storefront_draft') AND prosecdef;"
        ).trim(),
        '0'
      );
    }
  );
  for (const [name, user] of [
    ['anon', undefined],
    ['unrelated', other],
    ['non-builder staff', sales],
    ['suspended staff', suspended],
  ])
    await check(`real membership draft denial: ${name}`, async () => {
      const r = await request(
        'builder_page_drafts?select=draft_config,draft_seo,draft_store_settings,draft_setup_settings',
        user
      );
      if (user) {
        assert.equal(r.status, 200, JSON.stringify(r));
        assert.deepEqual(r.body, []);
      } else assert([401, 403, 404].includes(r.status));
      const old = await request('page_configs?select=draft_config', user);
      assert.equal(old.status, 400);
    });
  await check('real view-only staff can read but cannot save', async () => {
    const r = await request(
      'builder_page_drafts?select=draft_config,updated_at',
      viewer
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body[0].draft_config.content, 'PRIVATE-DRAFT');
    const patched = await request('builder_page_drafts?select=id', viewer, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ draft_config: { content: 'ATTACK' } }),
    });
    assert.equal(patched.status, 200, JSON.stringify(patched));
    assert.deepEqual(patched.body, []);
  });
  await check(
    'current public mobile projection survives full cutover',
    async () => {
      for (const user of [undefined, other]) {
        const r = await request(
          `page_configs?select=published_config&merchant_id=eq.${merchant}&page_slug=eq.home&is_published=eq.true`,
          user
        );
        assert.equal(r.status, 200, JSON.stringify(r));
        assert.equal(r.body[0].published_config.content, 'PUBLIC');
      }
    }
  );
  await runPrivateLifecycleChecks({
    request,
    check,
    owner,
    staff,
    other,
    merchant,
    sql,
    productionSources,
  });
  await check(
    'real staff revocation is effective for an existing JWT',
    async () => {
      const before = await request('builder_page_drafts?select=id', staff);
      assert.equal(before.status, 200);
      assert(before.body.length > 0);
      const change = await request(
        `staff_members?merchant_id=eq.${merchant}&user_id=eq.${staff}`,
        owner,
        { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) }
      );
      assert.equal(change.status, 204, JSON.stringify(change));
      const revoked = await request('builder_page_drafts?select=id', staff);
      assert.equal(revoked.status, 200);
      assert.deepEqual(revoked.body, []);
    }
  );
  for (const [name, user] of [
    ['anon', undefined],
    ['unrelated', other],
    ['non-builder staff', sales],
  ])
    await check(`real history/candidate isolation: ${name}`, async () => {
      for (const endpoint of [
        'page_config_history?select=config',
        'ai_jobs?select=input,output',
      ]) {
        const r = await request(endpoint, user);
        if (r.status === 200) assert.deepEqual(r.body, []);
        else assert([401, 403, 404].includes(r.status), JSON.stringify(r));
      }
    });
  if (productionSources)
    await runFullProvisioningChecks({ request, check, sql });
  console.log(
    JSON.stringify(
      {
        scope:
          'Full frozen history + current-tree sources, real membership helpers, disposable private cutover',
        productionSources,
        records,
        result: 'PASS',
        productionActivation: false,
      },
      null,
      2
    )
  );
} finally {
  cleanup();
}
