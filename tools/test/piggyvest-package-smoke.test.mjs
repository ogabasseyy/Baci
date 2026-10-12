import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildPiggyvestSmokeArtifacts } from './piggyvest-package-smoke.mjs';

test('bundles real factories without ambient configuration and runs the actual HTTP router', async () => {
  const result = await buildPiggyvestSmokeArtifacts();
  const directory = await mkdtemp(join(tmpdir(), 'baci-piggyvest-package-'));
  let server;
  try {
    for (const artifact of result.artifacts)
      await writeFile(join(directory, artifact.name), artifact.bytes);
    const require = createRequire(join(directory, 'smoke.cjs'));
    assert.throws(
      () => require('./nativeProbe.cjs').requestNative(),
      /TEST-only native PostgreSQL disabled/
    );
    assert.deepEqual(result.testSubstitutions, [
      'process.env={} TEST-only',
      'server-only TEST marker',
      'pg-native TEST rejection',
    ]);
    assert.ok(result.externalDependencies.every(isBuiltin));
    const {
      startPiggyvestRuntimeCompositionServer: start,
    } = require('./http.cjs');
    const {
      createPiggyvestCustomerFundingScreen: funding,
    } = require('./funding.cjs');
    assert.equal(typeof start, 'function');
    assert.equal(typeof funding, 'function');
    let calls = 0;
    const execute = () => {
      calls++;
      return Promise.reject(new Error('synthetic-private-database'));
    };
    let authenticated = false;
    const createRlsClient = async () => ({
      auth: {
        getUser: async () => ({
          data: {
            user: authenticated
              ? { id: '90000000-0000-4000-8000-000000000001' }
              : null,
          },
          error: null,
        }),
      },
      from: (table) => {
        const rows = {
          merchants: { id: '10000000-0000-4000-8000-000000000001' },
          customers: {
            id: '20000000-0000-4000-8000-000000000001',
            merchant_id: '10000000-0000-4000-8000-000000000001',
            user_id: '90000000-0000-4000-8000-000000000001',
          },
          customer_savings_goals: {
            id: '30000000-0000-4000-8000-000000000001',
            merchant_id: '10000000-0000-4000-8000-000000000001',
            customer_id: '20000000-0000-4000-8000-000000000001',
          },
        };
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: rows[table], error: null }),
        };
        return query;
      },
    });
    await assert.rejects(
      start({ port: 0, configuration: undefined, createRlsClient, execute }),
      /Local savings runtime unavailable/
    );
    const configuration = {
      mode: 'local_test',
      goalId: '30000000-0000-4000-8000-000000000001',
      context: {
        environment: 'staging',
        transport: 'local_test',
        integrationId: '40000000-0000-4000-8000-000000000001',
        merchantId: '10000000-0000-4000-8000-000000000001',
        expectedBusinessId: 'synthetic-business',
        expectedProjectId: 'synthetic-project',
        actualProjectId: 'synthetic-project',
        allowlistedMerchantIds: ['10000000-0000-4000-8000-000000000001'],
        allowlistedCustomerIds: ['20000000-0000-4000-8000-000000000001'],
      },
      termsDocument: {
        version: 'synthetic-v1',
        hash: 'a'.repeat(64),
        text: 'Synthetic only.',
      },
    };
    server = await start({ port: 0, configuration, createRlsClient, execute });
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    for (const path of ['/policy', '/cancel', '/recovery']) {
      const response = await fetch(
        `${server.origin}${path}?goalId=${configuration.goalId}`
      );
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await response.text(), /synthetic-private/);
    }
    assert.equal((await fetch(`${server.origin}/funding`)).status, 401);
    assert.equal(
      (await fetch(`${server.origin}/policy`, { method: 'DELETE' })).status,
      405
    );
    assert.equal(
      (
        await fetch(`${server.origin}/policy`, {
          method: 'POST',
          headers: { origin: 'http://invalid.test' },
          body: '{}',
        })
      ).status,
      403
    );
    authenticated = true;
    assert.equal(
      (await fetch(`${server.origin}/funding?goalId=${configuration.goalId}`))
        .status,
      503
    );
    const bootstrap = await fetch(`${server.origin}/csrf`, {
      headers: { origin: server.origin, cookie: 'synthetic-session=owner' },
    });
    assert.equal(bootstrap.status, 200);
    const csrf = await bootstrap.json();
    const sessionCookie = [
      'synthetic-session=owner',
      ...bootstrap.headers.getSetCookie().map((value) => value.split(';')[0]),
    ].join('; ');
    const headers = {
      origin: server.origin,
      'content-type': 'application/json',
      cookie: sessionCookie,
      'x-csrf-token': 'wrong',
    };
    assert.equal(
      (
        await fetch(`${server.origin}/policy`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(`${server.origin}/policy`, {
          method: 'POST',
          headers: { ...headers, 'x-csrf-token': csrf.csrfToken },
          body: '{broken',
        })
      ).status,
      400
    );
    authenticated = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('Provider network prohibited');
    };
    try {
      const binder = funding({
        supabase: await createRlsClient(),
        goalId: configuration.goalId,
        configuration: configuration.context,
        termsDocument: configuration.termsDocument,
        execute,
        checkCsrfProtection: async () => ({ valid: false }),
        fundingConfiguration: undefined,
        fundingExecute: execute,
        mappingExecute: execute,
        fetchImplementation: () => {
          throw new Error('Provider network prohibited');
        },
      });
      assert.deepEqual(
        await binder.readScreen(
          new Request(`http://localhost/policy?goalId=${configuration.goalId}`)
        ),
        { environment: 'staging', status: 'unauthenticated' }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(calls, 0);
    assert.equal(result.artifacts.length, 4);
    for (const artifact of result.artifacts)
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    const rebuilt = await buildPiggyvestSmokeArtifacts();
    assert.deepEqual(
      rebuilt.artifacts.map(({ name, sha256 }) => ({ name, sha256 })),
      result.artifacts.map(({ name, sha256 }) => ({ name, sha256 }))
    );
    assert.ok(
      result.inputs.some((path) =>
        path.endsWith('runtime-composition-server.ts')
      )
    );
    assert.ok(
      result.inputs.some((path) => path.endsWith('customer-funding-screen.ts'))
    );
  } finally {
    if (server) await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
