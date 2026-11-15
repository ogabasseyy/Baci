import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { validateRequests } from './validate-requests.mjs';
import { verifyDurable } from './verify-durable.mjs';

const api = 'http://127.0.0.1:54371';
const fixture = fileURLToPath(new URL('.', import.meta.url));
const [statusPath, signingKeyPath] = process.argv.slice(2);
assert.ok(
  statusPath && signingKeyPath,
  'Pass local status JSON and generated signing keys'
);
assert.ok(
  !readdirSync(fixture).some((name) => name.startsWith('.env')),
  'Fixture directory must not contain env files'
);
const status = JSON.parse(readFileSync(statusPath, 'utf8'));
assert.equal(status.API_URL, api, 'Dedicated loopback Supabase required');
const [jwk] = JSON.parse(readFileSync(signingKeyPath, 'utf8'));
assert.ok(
  jwk?.kty === 'EC' && jwk.crv === 'P-256',
  'Fixture ES256 key required'
);
for (const key of Object.keys(process.env)) {
  if (!['PATH', 'HOME', 'TMPDIR'].includes(key)) delete process.env[key];
}
Object.assign(process.env, {
  NODE_ENV: 'development',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: api,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY,
  NEXT_PUBLIC_ROOT_DOMAIN: 'route-baci.invalid',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:54381',
  QUIZ_RPC_SERVER_SECRET: randomBytes(32).toString('hex'),
  SUPABASE_SERVICE_ROLE_KEY: 'unused-synthetic-schema-placeholder',
  SUPABASE_AGENTIC_JWT_PRIVATE_JWK: JSON.stringify(jwk),
  EVENT_PIPELINE_ENQUEUE_ENABLED: 'true',
});

const blockedOrigins = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== api) {
    blockedOrigins.push(url.origin);
    throw new Error('Only the isolated Supabase may be contacted');
  }
  return realFetch(input, { ...init, redirect: 'error' });
};

const postgres = (sql) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_ogabassey-signing-isolated-20261115',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
    ],
    { encoding: 'utf8', input: sql }
  ).trim();

const alpha = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a331';
const beta = '019bbd89-8f5f-7f8c-a4fd-42b5d7e7a339';
const alphaHost = 'route-alpha.route-baci.invalid';
const prefix = `isolated-route-${randomUUID()}`;
const { default: next } = await import('next');
const server = createServer();
const app = next({
  dev: true,
  dir: fixture,
  hostname: '127.0.0.1',
  port: 54381,
  httpServer: server,
  turbopack: true,
});

function event(label, overrides = {}) {
  return {
    event_type: 'page_view',
    merchant_id: alpha,
    event_id: `${prefix}-${label}`,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function post(payload, host = alphaHost, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: 54381,
        path: '/api/events',
        method: 'POST',
        headers: {
          host,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'user-agent': 'Mozilla/5.0',
          ...headers,
        },
      },
      (res) => {
        res.setEncoding('utf8');
        let output = '';
        res.on('data', (chunk) => {
          output += chunk;
        });
        res.on('end', () => {
          try {
            resolve([res.statusCode, JSON.parse(output)]);
          } catch {
            reject(
              new Error(`Unexpected non-JSON response (HTTP ${res.statusCode})`)
            );
          }
        });
      }
    );
    req.setTimeout(90_000, () =>
      req.destroy(new Error('HTTP route timed out'))
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function expectEvent(label, payload, host, headers) {
  assert.deepEqual(
    await post(payload, host, headers),
    [
      200,
      {
        success: true,
        ...(payload.event_id === undefined
          ? {}
          : { event_id: payload.event_id }),
      },
    ],
    label
  );
  console.log(`PASS ${label}`);
}

try {
  postgres(readFileSync(new URL('./context.sql', import.meta.url), 'utf8'));
  await app.prepare();
  // Next's development version check may try the package registry at startup.
  // The guard blocks it, as it blocks every external destination.
  assert.ok(
    blockedOrigins.every((origin) => origin === 'https://registry.npmjs.org')
  );
  blockedOrigins.length = 0;
  server.on('request', app.getRequestHandler());
  server.listen(54381, '127.0.0.1');
  await once(server, 'listening');

  const page = event('durable');
  await expectEvent('durable storefront', page, undefined, {
    cookie: '_fbp=synthetic-fbp',
  });
  await expectEvent('durable duplicate', page);
  await expectEvent(
    'real alias resolution',
    event('alias'),
    'route-old-alpha.route-baci.invalid'
  );
  await expectEvent(
    'verified custom host',
    event('custom'),
    'www.route-shop.invalid'
  );
  await expectEvent(
    'same-host page path',
    event('page-path', {
      page_url: 'https://route-baci.invalid/route-alpha/products',
    }),
    'route-baci.invalid'
  );
  await expectEvent(
    'referer path fallback',
    event('referer'),
    'route-baci.invalid',
    {
      referer: 'https://route-baci.invalid/route-alpha/products',
    }
  );

  await validateRequests({ alphaHost, beta, event, post });

  await expectEvent('crawler acknowledgment', event('crawler'), alphaHost, {
    'user-agent': 'Googlebot',
  });

  process.env.EVENT_PIPELINE_ALLOW_UNVERIFIED_TELEMETRY = 'true';
  await expectEvent(
    'explicit unverified telemetry',
    event('anonymous'),
    'route-baci.invalid'
  );
  delete process.env.EVENT_PIPELINE_ALLOW_UNVERIFIED_TELEMETRY;

  process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK = '{invalid synthetic JWK';
  assert.deepEqual(await post(event('bad-signer')), [
    500,
    { error: 'Internal server error' },
  ]);
  console.log('PASS malformed signing configuration gives safe 500');
  process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK = JSON.stringify(jwk);

  process.env.EVENT_PIPELINE_ENQUEUE_ENABLED = 'false';
  const noId = event('legacy-no-id', {
    event_id: undefined,
    session_id: prefix,
    event_type: 'add_to_cart',
    analytics_consent: true,
    marketing_consent: true,
  });
  await expectEvent('legacy persisted without event ID', noId);
  assert.equal(
    postgres(`
    SELECT count(*) FROM public.analytics_events
    WHERE event_id IS NULL AND merchant_id = '${alpha}' AND event_data->>'session_id' = '${prefix}';
  `),
    '1'
  );
  const legacy = event('legacy');
  const firstLegacyResponse = await post(legacy);
  const secondLegacyResponse = await post(legacy);

  verifyDurable({ postgres, prefix, alpha, page });
  assert.deepEqual(blockedOrigins, []);
  console.log(
    'PASS durable persistence: six unique ledger rows with matching queue entries'
  );
  assert.deepEqual(
    firstLegacyResponse,
    [200, { success: true, event_id: legacy.event_id }],
    'legacy event with ID'
  );
  assert.deepEqual(
    secondLegacyResponse,
    firstLegacyResponse,
    'legacy duplicate with ID'
  );
  const legacyRows = postgres(`
    SELECT event_id || '|' || merchant_id || '|' || event_type
    FROM public.analytics_events WHERE event_id LIKE '${prefix}-%'
    ORDER BY event_id;
  `).split('\n');
  assert.deepEqual(
    legacyRows,
    [
      'alias',
      'anonymous',
      'custom',
      'durable',
      'legacy',
      'page-path',
      'referer',
    ].map((label) => `${prefix}-${label}|${alpha}|page_view`)
  );
  assert.deepEqual(blockedOrigins, []);
  console.log(
    'PASS persistence: six durable ledger entries, seven analytics rows, no duplicate or rejected rows, no external fetch attempts'
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
  await app.close();
}

// Next's development watchers can outlive app.close() in a custom server.
process.exit();
