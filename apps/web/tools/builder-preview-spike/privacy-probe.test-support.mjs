/** Disposable policy characterization, NOT a complete Supabase migration replay. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { runPrivateLifecycleChecks } from './private-lifecycle-checks.mjs';
import { buildPrivatePolicyFixture } from './private-policy-fixture.mjs';

const root = new URL('../../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const suffix = randomUUID().slice(0, 8);
const network = `builder-spike-${suffix}`;
const db = `${network}-db`;
const api = `${network}-api`;
const secret = 'task-zero-disposable-fixture-jwt-secret-not-a-real-credential';
const owner = '20000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
const staff = '20000000-0000-4000-8000-000000000003';
const merchant = '10000000-0000-4000-8000-000000000001';
const records = [];
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10_000,
  }).trim();
const sql = (query) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      db,
      'psql',
      '-U',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
    ],
    { input: query, encoding: 'utf8', timeout: 10_000 }
  );
const token = (sub) => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role: 'authenticated', sub, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${message}.${createHmac('sha256', secret).update(message).digest('base64url')}`;
};
async function check(name, callback) {
  await callback();
  records.push({ name, result: 'PASS' });
}
function cleanup() {
  for (const name of [api, db]) {
    try {
      docker('rm', '-f', name);
    } catch {
      /* owned fixture only */
    }
  }
  try {
    docker('network', 'rm', network);
  } catch {
    /* preserve primary failure */
  }
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    cleanup();
    process.exit(143);
  });
}
try {
  docker('network', 'create', network);
  docker(
    'run',
    '--rm',
    '-d',
    '--name',
    db,
    '--network',
    network,
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=256m',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    'postgres:17-alpine'
  );
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      docker('exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
      ready = true;
      break;
    } catch {
      await setTimeout(250);
    }
  }
  assert(ready, 'Disposable database did not become ready');
  sql(buildPrivatePolicyFixture({ read, owner, staff, merchant }));
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
    `PGRST_DB_URI=postgres://authenticator@${db}:5432/postgres`,
    '-e',
    'PGRST_DB_ANON_ROLE=anon',
    '-e',
    'PGRST_DB_SCHEMAS=public',
    '-e',
    `PGRST_JWT_SECRET=${secret}`,
    'public.ecr.aws/supabase/postgrest:v16.2'
  );
  if (process.env.BACI_BUILDER_PROBE_ABORT_CHECK === '1') {
    console.log(JSON.stringify({ network, db, api }));
    await setTimeout(60_000);
  }
  const address = docker('port', api, '3000/tcp');
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const url = `http://${address}`;
  const request = async (path, user, options = {}) => {
    const response = await fetch(`${url}/${path}`, {
      signal: AbortSignal.timeout(5000),
      ...options,
      headers: {
        ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    const payload = await response.text();
    return {
      status: response.status,
      body: payload ? JSON.parse(payload) : null,
    };
  };
  for (let i = 0; i < 40; i++) {
    try {
      const r = await request('page_configs?select=published_config');
      if (r.status === 200) break;
    } catch {
      /* bounded local readiness polling */
    }
    await setTimeout(250);
  }
  const draftQuery =
    'page_configs?select=draft_config,draft_seo,draft_store_settings,draft_setup_settings';
  for (const [name, user] of [
    ['anon', undefined],
    ['unrelated tenant', other],
  ]) {
    await check(
      `baseline disclosure reproduced through raw API: ${name}`,
      async () => {
        const r = await request(draftQuery, user);
        assert.equal(r.status, 200);
        assert.equal(r.body[0].draft_config.content, 'PRIVATE-DRAFT');
        assert.equal(r.body[0].draft_seo.title, 'PRIVATE-SEO');
        assert.equal(r.body[0].draft_store_settings.value, 'PRIVATE-STORE');
        assert.equal(r.body[0].draft_setup_settings.value, 'PRIVATE-SETUP');
      }
    );
  }
  if (process.env.BACI_BUILDER_NEWER_PRIVATE === '1') {
    sql(`INSERT INTO public.builder_page_drafts(id,merchant_id,draft_config,updated_at)
      SELECT id,merchant_id,'{"content":"PRIVATE-NEWER"}',clock_timestamp()+interval '1 second' FROM public.page_configs;`);
  }
  sql(read('apps/web/tools/builder-preview-spike/private-split.sql'));
  if (process.env.BACI_BUILDER_NEWER_PRIVATE === '1') {
    await check('cutover preserves a newer existing private draft', () => {
      assert.equal(
        sql(
          "SELECT draft_config->>'content' FROM public.builder_page_drafts;"
        ).trim(),
        'PRIVATE-NEWER'
      );
    });
    // Return only this synthetic row to the shared lifecycle test's starting state.
    sql(
      `DELETE FROM public.builder_page_drafts; INSERT INTO public.builder_page_drafts(id,merchant_id,draft_config,draft_seo,draft_store_settings,draft_setup_settings) SELECT id,merchant_id,'{"content":"PRIVATE-DRAFT"}','{"title":"PRIVATE-SEO"}','{"value":"PRIVATE-STORE"}','{"value":"PRIVATE-SETUP"}' FROM public.page_configs;`
    );
  }

  sql(read('apps/web/tools/builder-preview-spike/private-lifecycle.sql'));
  // Wait for the schema cache to observe dropped public columns.
  for (let i = 0; i < 40; i++) {
    const r = await request(draftQuery);
    if (r.status === 400) break;
    await setTimeout(250);
  }
  for (let i = 0; i < 40; i++) {
    const r = await request('builder_page_drafts?select=version', owner);
    if (r.status === 200) break;
    await setTimeout(250);
  }
  for (const [name, user] of [
    ['anon', undefined],
    ['unrelated tenant', other],
  ]) {
    await check(
      `split blocks explicit public draft columns: ${name}`,
      async () => {
        assert.equal((await request(draftQuery, user)).status, 400);
      }
    );
    await check(`split private table denies draft rows: ${name}`, async () => {
      const r = await request(
        'builder_page_drafts?select=draft_config,draft_seo,draft_store_settings,draft_setup_settings',
        user
      );
      if (user) {
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.deepEqual(r.body, []);
      } else {
        assert([401, 403, 404].includes(r.status));
        assert(!JSON.stringify(r.body).includes('PRIVATE-'));
      }
    });
    await check(`installed public projection preserved: ${name}`, async () => {
      const r = await request(
        `page_configs?select=published_config&merchant_id=eq.${merchant}&page_slug=eq.home&is_published=eq.true`,
        user
      );
      assert.equal(r.status, 200);
      assert.equal(r.body[0].published_config.content, 'PUBLIC');
    });
  }
  for (const [name, user, version] of [
    ['owner', owner, 1],
    ['staff', staff, 2],
  ]) {
    await check(`private draft read and CAS: ${name}`, async () => {
      const before = await request(
        'builder_page_drafts?select=version,draft_config',
        user
      );
      assert.equal(before.status, 200);
      assert.equal(before.body[0].version, version);
      const path = `builder_page_drafts?version=eq.${version}`;
      const opts = {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ version: version + 1 }),
      };
      const first = await request(path, user, opts);
      assert.equal(first.status, 200);
      assert.equal(first.body.length, 1);
      const stale = await request(path, user, opts);
      assert.equal(stale.status, 200);
      assert.deepEqual(stale.body, []);
    });
  }
  for (let i = 0; i < 40; i++) {
    const r = await request('rpc/builder_private_load', owner, {
      method: 'POST',
      body: JSON.stringify({ p_merchant_id: merchant, p_slug: 'home' }),
    });
    if (r.status === 200) break;
    await setTimeout(250);
  }
  await runPrivateLifecycleChecks({
    request,
    check,
    owner,
    staff,
    other,
    merchant,
    sql,
  });
  await check(
    'legacy draft query is incompatible after removing public copies',
    async () => {
      const r = await request(
        `page_configs?select=id,draft_config,updated_at&merchant_id=eq.${merchant}&page_slug=eq.home`,
        owner
      );
      assert.equal(r.status, 400);
    }
  );
  console.log(
    JSON.stringify(
      {
        scope:
          'Extracted policy characterization only; NOT full migration or application compatibility acceptance',
        records,
        decision: 'NO-GO',
      },
      null,
      2
    )
  );
} finally {
  cleanup();
}
