import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const clients = vi.hoisted(() => ({ owner: undefined as unknown }));
vi.mock('@/lib/supabase/authenticated-user-client', () => ({
  createAuthenticatedUserClient: async () => clients.owner,
}));

import { startProductionBuilderStack } from '@/lib/experience/production-builder-stack';
import { createLinkedSessionService } from '../../tools/builder-auth/session-service';
import {
  type QualificationKind,
  runLocalQualification,
} from '../../tools/experience-runner/local-oci-executor';
import {
  createRunnerExecutor,
  createRunnerHandler,
} from '../../tools/experience-runner/runner-transport';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { createVerifierBuildRecorder } from '../../tools/experience-verifier/build-recorder';
import { createIndependentBuildVerifier } from '../../tools/experience-verifier/build-verifier';
import { createVerifierCaptureWorker } from '../../tools/experience-verifier/capture-worker';
import { experienceDataFixture } from './data-fixture.test-support';
import {
  checkProductionStackJourney,
  readDelivery,
} from './production-stack-journey.test-support';
import { syntheticOAuth } from './synthetic-oauth.test-support';
import { setupBuildVerification } from './verifier-build-loopback.test-support';
import { setupVerifierPool } from './verifier-pool.test-support';

async function unusedPort() {
  const s = createServer();
  await new Promise<void>((resolve, reject) =>
    s.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const address = s.address();
  if (!address || typeof address === 'string') throw Error('NO_PORT');
  await new Promise<void>((resolve, reject) =>
    s.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

it('serves full-code MCP through the real production stack and synthetic owner RLS', async () => {
  const f = await experienceDataFixture();
  const dir = mkdtempSync(join(tmpdir(), 'baci-stack-rls-'));
  let stack:
    | Awaited<ReturnType<typeof startProductionBuilderStack>>
    | undefined;
  let verifierPool: Pool | undefined;
  let buildVerification:
    | Awaited<ReturnType<typeof setupBuildVerification>>
    | undefined;
  try {
    clients.owner = f.owner.supabase;
    await f.db.pool.query('UPDATE merchants SET slug=$2 WHERE id=$1', [
      f.merchantId,
      'synthetic',
    ]);
    const runnerKey = new Uint8Array(32).fill(1);
    const useLocalRunner =
      process.env.BACI_LOCAL_EXPERIENCE_QUALIFICATION === '1';
    const execute = vi.fn(async (kind: QualificationKind, payload: unknown) => {
      if (
        useLocalRunner &&
        (kind === 'prerender-build' ||
          kind === 'prerender' ||
          kind === 'capture')
      )
        return runLocalQualification(kind, payload);
      throw Error('SYNTHETIC_RUNNER_UNAVAILABLE');
    });
    const runner = createRunnerHandler({
      key: runnerKey,
      toolchainDigest: 'a'.repeat(64),
      execute,
    });
    const runnerSettings = {
      endpoint: 'https://runner.synthetic.test/v1/execute',
      key: runnerKey,
      toolchainDigest: 'a'.repeat(64),
      fetch: (url: RequestInfo | URL, init?: RequestInit) =>
        runner(new Request(url, init)),
    };
    const bootstrap = {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'synthetic',
      },
      catalog: { revision: 'synthetic', products: [] },
      capabilities: ['navigation', 'catalog.read'] as Array<
        'navigation' | 'catalog.read'
      >,
    };
    if (useLocalRunner) {
      verifierPool = await setupVerifierPool(f);
      const verify = createIndependentBuildVerifier({
        execute: createRunnerExecutor(runnerSettings),
        bootstrap: async () => bootstrap,
        canonicalBase: async () => 'https://synthetic.synthetic.test',
        previewOrigin: 'https://builder.synthetic.test',
        executionOrigin: 'https://output.synthetic-output.test',
        record: await createVerifierBuildRecorder(verifierPool),
      });
      const capture = await createVerifierCaptureWorker({
        pool: verifierPool,
        hostOrigin: 'https://synthetic.synthetic.test',
        previewOrigin: 'https://builder.synthetic.test',
        bootstrap: async () => bootstrap,
        runner: runnerSettings,
      });
      buildVerification = await setupBuildVerification({
        f,
        pool: verifierPool,
        key: new Uint8Array(32).fill(3),
        verify,
        capture,
        previewOrigin: 'https://builder.synthetic.test',
      });
    }
    const { token, publicJwk, connectionId } = await syntheticOAuth(f, dir);
    const port = await unusedPort();
    let deliveryPort = await unusedPort();
    while (deliveryPort === port) deliveryPort = await unusedPort();
    const closeBroker = vi.fn(async () => {});
    let bootstrapCount = 0;
    stack = await startProductionBuilderStack({
      port,
      deliveryPort,
      host: {
        startBroker: async () => ({
          runtime: {
            readConnection: f.db.storage.readConnection,
            resolveLinkedAccessToken: createLinkedSessionService({
              storage: f.db.storage,
              refresh: async () => {
                throw Error('Unexpected refresh');
              },
              verifyUser: async (accessToken) => {
                if (accessToken !== f.owner.accessToken)
                  throw Error('Wrong synthetic user');
                return f.actorId;
              },
            }),
          },
          publicBinding: {
            supabase: {
              url: 'https://synthetic.supabase.co',
              anonKey: 'synthetic-public',
            },
            jwks: {
              keys: [publicJwk],
            },
          },
          close: closeBroker,
        }),
        integration: {
          hostOrigin: 'https://builder.synthetic.test',
          executionOrigin: 'https://output.synthetic-output.test',
          artifactDirectory: dir,
          canonicalBase: (slug: string) => `https://${slug}.synthetic.test`,
          publicClient: f.anonymous,
          approval: {
            load: vi.fn(),
            confirm: vi.fn(),
            loadLifecycle: vi.fn(),
            confirmPublication: vi.fn(),
            confirmModeExit: vi.fn(),
          },
          runner: {
            endpoint: 'https://runner.synthetic.test/v1/execute',
            key: runnerKey,
            toolchainDigest: 'a'.repeat(64),
            fetch: (url, init) => runner(new Request(url, init)),
          },
          build: {
            key: new Uint8Array(32).fill(2),
            toolchainDigest: 'a'.repeat(64),
            transient: createTransientOutputStore(),
            recordVerifiedEvidence: buildVerification?.client ?? vi.fn(),
          },
          bootstrap: async () => {
            bootstrapCount++;
            if (useLocalRunner && bootstrapCount === 2)
              throw Error('SYNTHETIC_PERFORMANCE_DATA_UNAVAILABLE');
            return bootstrap;
          },
          ...(buildVerification
            ? { remoteCapture: buildVerification.capture }
            : { recordCapture: vi.fn() }),
        },
      },
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await fetch(`http://127.0.0.1:${port}/builder/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name,
            arguments: args,
          },
        }),
      });
      expect(response.status).toBe(200);
      return await response.json();
    };
    const { store, deliveredUrl } = await checkProductionStackJourney({
      call,
      f,
      stack,
      deliveryPort,
      useLocalRunner,
      runnerKinds: () => execute.mock.calls.map(([kind]) => kind),
      countBootstraps: () => bootstrapCount,
    });
    const revoker = await f.db.pool.connect();
    try {
      await revoker.query('BEGIN');
      await revoker.query(
        "SELECT set_config('request.jwt.claim.sub',$1,true)",
        [f.actorId]
      );
      await revoker.query(
        "UPDATE builder_authorization.connections SET status='revoked',revoked_at=now() WHERE id=$1",
        [connectionId]
      );
      await revoker.query('COMMIT');
    } finally {
      revoker.release();
    }
    expect(await call('get_experience_capabilities', store)).toMatchObject({
      result: {
        structuredContent: { status: 'error', code: 'CONNECTION_REVOKED' },
      },
    });
    if (deliveredUrl) {
      await f.db.pool.query('DELETE FROM auth.sessions WHERE id=$1', [
        f.sessionId,
      ]);
      const url = new URL(deliveredUrl);
      expect(
        (
          await readDelivery(
            deliveryPort,
            `${url.pathname}${url.search}`,
            'output.synthetic-output.test'
          )
        ).status
      ).toBe(404);
    }
    await stack.close();
    stack = undefined;
    expect(closeBroker).toHaveBeenCalledOnce();
  } finally {
    await stack?.close();
    await buildVerification?.close();
    await verifierPool?.end();
    clients.owner = undefined;
    rmSync(dir, { recursive: true, force: true });
    await f.close();
  }
}, 300000);
