import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));
const clients = vi.hoisted(() => ({ owner: undefined as unknown }));
vi.mock('@/lib/supabase/authenticated-user-client', () => ({
  createAuthenticatedUserClient: async () => clients.owner,
}));

import { confirmDraftApply } from '@/lib/experience/approval-service';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { getExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
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

async function readDelivery(port: number, path: string, host: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, headers: { host } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.once('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
        res.once('error', reject);
      }
    );
    req.once('error', reject);
    req.end();
  });
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
    const store = { storefrontId: f.merchantId };
    expect(await call('get_experience_capabilities', store)).toMatchObject({
      result: {
        structuredContent: {
          status: 'ok',
          value: { mode: 'full-custom-code', aiProviderCalls: 0 },
        },
      },
    });
    const content =
      'export default function App(){return <h1>Synthetic production stack</h1>}';
    const readId = (
      key:
        | 'uploadId'
        | 'artifactId'
        | 'jobId'
        | 'buildId'
        | 'evidenceId'
        | 'approvalId',
      value: unknown
    ) =>
      z
        .object({
          result: z.object({
            structuredContent: z.object({
              status: z.literal('ok'),
              value: z.record(z.string(), z.unknown()),
            }),
          }),
        })
        .parse(value).result.structuredContent.value[key];
    const uploadId = z.uuid().parse(
      readId(
        'uploadId',
        await call('begin_experience_upload', {
          ...store,
          manifest: {
            format: 'baci.experience/v2',
            runtime: 'react-browser-sandbox/v1',
            sdkVersion: 'commerce-bridge/v1',
            entry: 'app.tsx',
            files: [{ path: 'app.tsx', content: '' }],
            packages: [],
            routes: [{ path: '/', view: 'home' }],
            assets: [],
            capabilities: ['navigation', 'catalog.read'],
          },
          files: {
            files: [
              {
                path: 'app.tsx',
                bytes: Buffer.byteLength(content),
                digest: digestBytes(content),
              },
            ],
          },
        })
      )
    );
    expect(
      await call('write_experience_chunk', {
        ...store,
        uploadId,
        path: 'app.tsx',
        offset: 0,
        bytesBase64: Buffer.from(content).toString('base64'),
        chunkDigest: digestBytes(content),
      })
    ).toMatchObject({ result: { structuredContent: { status: 'ok' } } });
    const artifactId = z
      .uuid()
      .parse(
        readId(
          'artifactId',
          await call('finalize_experience_upload', { ...store, uploadId })
        )
      );
    const jobId = z.uuid().parse(
      readId(
        'jobId',
        await call('build_experience', {
          ...store,
          artifactId,
          idempotencyKey: randomUUID(),
        })
      )
    );
    expect(
      await call('get_experience_operation', { ...store, jobId })
    ).toMatchObject({ result: { structuredContent: { status: 'ok' } } });
    const finalized = await call('finalize_experience_build', {
      ...store,
      jobId,
      idempotencyKey: randomUUID(),
    });
    expect(finalized).toMatchObject(
      useLocalRunner
        ? {
            result: {
              structuredContent: {
                status: 'ok',
                value: {
                  performance: {
                    status: 'not-measured',
                    releaseQualified: false,
                  },
                },
              },
            },
          }
        : {
            result: {
              structuredContent: { status: 'error', code: 'UNAVAILABLE' },
            },
          }
    );
    const kinds = execute.mock.calls.map(([kind]) => kind);
    let deliveredUrl: string | undefined;
    if (useLocalRunner) {
      expect(kinds.slice(0, 3)).toEqual([
        'prerender-build',
        'prerender-build',
        'prerender',
      ]);
      expect(
        kinds.filter((kind) => kind === 'capture').length
      ).toBeGreaterThanOrEqual(24);
      expect(kinds).not.toContain('performance');
    } else expect(kinds).toEqual(['prerender-build']);
    expect(bootstrapCount).toBe(useLocalRunner ? 2 : 1);
    expect(
      await call('get_experience_operation', { ...store, jobId })
    ).toMatchObject({
      result: {
        structuredContent: {
          status: 'ok',
          value: { id: jobId, status: useLocalRunner ? 'finalized' : 'failed' },
        },
      },
    });
    if (useLocalRunner) {
      const buildId = z.uuid().parse(readId('buildId', finalized));
      const preview = await call('preview_experience', {
        ...store,
        buildId,
        routeId: 'home',
        idempotencyKey: randomUUID(),
      });
      const evidenceId = z.uuid().parse(readId('evidenceId', preview));
      expect(preview).toMatchObject({
        result: {
          structuredContent: {
            status: 'ok',
            value: {
              buildId,
              performance: { qualification: { status: 'not-measured' } },
            },
          },
        },
      });
      const approval = await call('apply_experience', {
        ...store,
        buildId,
        evidenceId,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      });
      const approvalId = z.uuid().parse(readId('approvalId', approval));
      expect(approval).toMatchObject({
        result: {
          structuredContent: {
            status: 'ok',
            value: { status: 'confirmation-required' },
          },
        },
      });
      await expect(
        confirmDraftApply(f.owner.supabase, approvalId)
      ).rejects.toThrow('CONFIRMATION_UNAVAILABLE');
      const ownerRuntime = getExperienceOwnerRuntime();
      if (!ownerRuntime) throw Error('OWNER_RUNTIME_MISSING');
      const launch = z
        .object({ src: z.url(), renderMode: z.literal('prerender') })
        .parse(
          await ownerRuntime.createPreviewLaunch(
            { ...f.owner, requestOrigin: 'https://builder.synthetic.test' },
            { buildId, routeId: 'home' }
          )
        );
      const url = new URL(launch.src);
      expect(url.origin).toBe('https://output.synthetic-output.test');
      const direct = await stack.deliver(new Request(launch.src));
      if (direct.status !== 200)
        throw Error(`DIRECT_PREVIEW_${direct.status}_${await direct.text()}`);
      deliveredUrl = `http://127.0.0.1:${deliveryPort}${url.pathname}${url.search}`;
      const delivered = await readDelivery(
        deliveryPort,
        `${url.pathname}${url.search}`,
        url.host
      );
      if (delivered.status !== 200)
        throw Error(`LISTENER_PREVIEW_${delivered.status}_${delivered.body}`);
      expect(delivered.status).toBe(200);
      expect(delivered.body).toContain('Synthetic production stack');
    }
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
