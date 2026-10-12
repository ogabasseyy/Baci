import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NextRequest } from 'next/server';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import type { createPiggyvestPostgresExecutor } from './postgres-executor';
import type { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

export async function startRuntimeJourneyLocal(options: {
  socketDirectory: unknown;
  sequence: 701 | 702 | 703 | 704;
  providerReadBarrier?: (url: string) => Promise<void>;
  browserOrigin?: 'http://127.0.0.1:4181' | 'http://127.0.0.1:4183';
  csrfCookiePath?: '/scenario/701' | '/scenario/702' | '/scenario/703';
}) {
  if (
    ![701, 702, 703, 704].includes(options.sequence) ||
    (options.browserOrigin !== undefined &&
      options.browserOrigin !== 'http://127.0.0.1:4181' &&
      options.browserOrigin !== 'http://127.0.0.1:4183') ||
    (options.csrfCookiePath !== undefined &&
      options.csrfCookiePath !== `/scenario/${options.sequence}`)
  )
    throw new Error('Fixed synthetic browser scope required');
  const goalId = `30000000-0000-4000-8000-000000000${options.sequence}`;
  const revisionId = `70000000-0000-4000-8000-000000000${options.sequence}`;
  const walletId = `synthetic-wallet-${options.sequence}`;
  const fixture = createFundingScreenFixture();
  const database = {
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: options.socketDirectory,
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    port: 55449,
  };
  const helper = pathToFileURL(
    resolve(process.cwd(), '../../tools/test/piggyvest-package-smoke.mjs')
  ).href;
  const packager: {
    buildPiggyvestSmokeArtifacts: () => Promise<{
      artifacts: Array<{ name: string; bytes: Uint8Array; sha256: string }>;
    }>;
  } = await import(helper);
  const artifacts = (await packager.buildPiggyvestSmokeArtifacts()).artifacts;
  if (
    !artifacts.some((entry) => entry.name === 'http.cjs') ||
    !artifacts.some((entry) => entry.name === 'executor.cjs')
  )
    throw new Error('Actual runtime artifacts missing');
  const directory = await mkdtemp(join(tmpdir(), 'baci-piggyvest-journey-'));
  let server:
    | Awaited<ReturnType<typeof startPiggyvestRuntimeCompositionServer>>
    | undefined;
  const providerCalls: string[] = [];
  try {
    for (const artifact of artifacts)
      await writeFile(join(directory, artifact.name), artifact.bytes);
    const require = createRequire(join(directory, 'entry.cjs'));
    const bundled: {
      createPiggyvestPostgresExecutor: typeof createPiggyvestPostgresExecutor;
    } = require('./executor.cjs');
    const execute = bundled.createPiggyvestPostgresExecutor({
      ...database,
      role: 'piggyvest_staging_policy_writer',
    });
    const mapping = bundled.createPiggyvestPostgresExecutor({
      ...database,
      role: 'piggyvest_staging_worker',
    });
    const runtime: {
      startPiggyvestRuntimeCompositionServer: typeof startPiggyvestRuntimeCompositionServer;
    } = require('./http.cjs');
    server = await runtime.startPiggyvestRuntimeCompositionServer({
      port: 0,
      browserOrigin: options.browserOrigin,
      csrfCookiePath: options.csrfCookiePath,
      configuration: {
        mode: 'local_test',
        goalId,
        context: fixture.options.configuration,
        termsDocument: fixture.options.termsDocument,
      },
      execute,
      createRlsClient: (request: NextRequest) => {
        const source = createFundingScreenFixture();
        source.rows.customer_savings_goals = {
          id: goalId,
          merchant_id: source.identity.merchantId,
          customer_id: source.identity.customerId,
        };
        const session = request.cookies.get('synthetic-session')?.value;
        if (session !== 'owner')
          source.getUser.mockResolvedValue({
            data: {
              user: {
                id:
                  session === 'other'
                    ? '90000000-0000-4000-8000-000000000002'
                    : '',
              },
            },
            error: null,
          });
        return Promise.resolve(source.options.supabase);
      },
      services: {
        lifecycle: { enabled: true },
        schedule: { enabled: true },
        funding: {
          fundingConfiguration: fixture.options.fundingConfiguration,
          fundingExecute: execute,
          mappingExecute: async (statement, parameters) => {
            const result = await mapping(statement, parameters);
            if (!Array.isArray(result.rows))
              throw new Error('Mapping unavailable');
            return { rows: result.rows };
          },
          fetchImplementation: async (input, init) => {
            const url = String(input);
            providerCalls.push(url);
            await options.providerReadBarrier?.(url);
            if (init?.method !== 'GET')
              throw new Error('Provider mutations prohibited');
            const base = `https://staging.piggyvest.business/api/v1/wallet/${walletId}`;
            if (url === base)
              return Promise.resolve(
                Response.json({
                  status: true,
                  data: {
                    id: walletId,
                    business_id: 'synthetic-business',
                    currency: 'NGN',
                    status: 'active',
                    balance: 999999999,
                  },
                })
              );
            if (url === `${base}/accounts`)
              return Promise.resolve(
                Response.json({
                  status: true,
                  data: [
                    {
                      account_number: '0001234567',
                      account_name: 'Synthetic account',
                      bank_name: 'Synthetic bank',
                      paypoint_id: null,
                      paypoint_name: null,
                    },
                  ],
                })
              );
            throw new Error('Unexpected provider target');
          },
        },
      },
    });
    const origin = server.origin;
    let cookie = 'synthetic-session=owner';
    let token = '';
    function request(path: string, init: RequestInit = {}) {
      const headers = new Headers({
        cookie: cookie,
        origin: options.browserOrigin ?? origin,
        'content-type': 'application/json',
        'x-csrf-token': token,
      });
      new Headers(init.headers).forEach((value, key) => {
        headers.set(key, value);
      });
      return fetch(`${origin}${path}`, { ...init, headers });
    }
    return {
      origin,
      goalId,
      revisionId,
      providerCalls,
      syntheticSessionCookie: 'synthetic-session=owner',
      request,
      async bootstrap() {
        const response = await request('/csrf');
        if (response.status !== 200)
          throw new Error(`CSRF bootstrap rejected ${response.status}`);
        const body: { csrfToken: string; expiresAt: string } =
          await response.json();
        token = body.csrfToken;
        for (const value of response.headers.getSetCookie())
          cookie += `; ${value.split(';')[0]}`;
        return body;
      },
      async close() {
        await server?.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
