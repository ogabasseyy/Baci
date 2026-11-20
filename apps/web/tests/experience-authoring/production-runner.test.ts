import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('server-only', () => ({}));

const web = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => web.client,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: async (
    _client: unknown,
    _user: string,
    input: { requestedMerchantId: string }
  ) => ({
    merchantId: input.requestedMerchantId,
    staffAccess: { isOwner: true },
  }),
}));

import { runExperienceBuild } from '@/lib/experience/local-build-supervisor';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { createLocalPrerenderArtifacts } from '../../tools/experience-runner/prerender-artifacts';
import {
  createRunnerExecutor,
  createRunnerHandler,
} from '../../tools/experience-runner/runner-transport';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { createVerifierBuildRecorder } from '../../tools/experience-verifier/build-recorder';
import { createIndependentBuildVerifier } from '../../tools/experience-verifier/build-verifier';
import { createVerifierCaptureWorker } from '../../tools/experience-verifier/capture-worker';
import { experienceDataFixture } from './data-fixture.test-support';
import { startMcpRunnerFixture } from './mcp-runner.test-support';
import { checkProductionRunnerPreview } from './production-runner-preview.test-support';
import { setupBuildVerification } from './verifier-build-loopback.test-support';
import { setupVerifierPool } from './verifier-pool.test-support';

it('normal owner RLS -> signed runner -> offline HTTPS browser matrix -> private prerender delivery -> revocation, with no publication', async () => {
  const f = await experienceDataFixture();
  let verifierPool: Pool | undefined;
  let buildVerification:
    | Awaited<ReturnType<typeof setupBuildVerification>>
    | undefined;
  let mcp: Awaited<ReturnType<typeof startMcpRunnerFixture>> | undefined;
  try {
    const hostOrigin = 'https://shop.synthetic.test';
    const previewOrigin = 'https://builder.synthetic-baci.test';
    const executionOrigin = 'https://output.baci-offline.invalid';
    const toolchainDigest = JSON.parse(
      readFileSync(
        new URL(
          '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-b-toolchain.json',
          import.meta.url
        ),
        'utf8'
      )
    ).digest as string;
    const key = randomBytes(32);
    const handler = createRunnerHandler({
      key,
      toolchainDigest,
      execute: async (kind, payload) => {
        try {
          return await runLocalQualification(kind, payload);
        } catch (error) {
          const details = error && typeof error === 'object' ? error : {};
          console.error('SYNTHETIC_RUNNER_FAILURE', {
            kind,
            code:
              'code' in details && typeof details.code === 'number'
                ? details.code
                : 'PROCESS_FAILURE',
            killed: 'killed' in details && details.killed === true,
          });
          throw error;
        }
      },
    });
    // No remote service: the HTTPS control-plane request is dispatched in-process.
    // Only the broker's injected fixed OCI executor runs authored code.
    const execute = createRunnerExecutor({
      endpoint: 'https://runner.baci-offline.invalid/v1/execute',
      key,
      toolchainDigest,
      fetch: (url, init) => handler(new Request(url, init)),
    });
    const content =
      'export default function Orbit(){return <main><h1>Synthetic Orbit production ports</h1><button>Custom ink</button></main>}';
    const manifest: ExperienceManifest = {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [{ path: 'app.tsx', content: '' }],
      packages: [],
      routes: [{ path: '/', view: 'home' }],
      assets: [],
      capabilities: ['navigation', 'catalog.read'],
    };
    let dependencies: Parameters<typeof runExperienceBuild>[2] | undefined;
    const capturedBuild: {
      value?: Awaited<ReturnType<typeof runExperienceBuild>>;
    } = {};
    mcp = await startMcpRunnerFixture(f, async (ctx, input) => {
      if (!dependencies) throw Error('BUILD_NOT_READY');
      capturedBuild.value = await runExperienceBuild(ctx, input, dependencies);
      return capturedBuild.value;
    });
    const upload = z
      .object({
        status: z.literal('ok'),
        value: z.object({ uploadId: z.uuid() }),
      })
      .parse(
        await mcp.call('begin_experience_upload', {
          storefrontId: f.merchantId,
          manifest,
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
      );
    const chunk = await mcp.call('write_experience_chunk', {
      storefrontId: f.merchantId,
      uploadId: upload.value.uploadId,
      path: 'app.tsx',
      offset: 0,
      bytesBase64: Buffer.from(content).toString('base64'),
      chunkDigest: digestBytes(content),
    });
    expect(chunk).toMatchObject({ status: 'ok' });
    const artifact = z
      .object({
        status: z.literal('ok'),
        value: z.object({ artifactId: z.uuid() }),
      })
      .parse(
        await mcp.call('finalize_experience_upload', {
          storefrontId: f.merchantId,
          uploadId: upload.value.uploadId,
        })
      );
    const queued = z
      .object({ status: z.literal('ok'), value: z.object({ jobId: z.uuid() }) })
      .parse(
        await mcp.call('build_experience', {
          storefrontId: f.merchantId,
          artifactId: artifact.value.artifactId,
          idempotencyKey: randomUUID(),
        })
      );
    const job = queued.value;
    const bootstrap: PublicBootstrap = {
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'synthetic',
      },
      catalog: { revision: 'synthetic', products: [] },
      capabilities: manifest.capabilities,
    };
    let artifacts = createLocalPrerenderArtifacts();
    verifierPool = await setupVerifierPool(f);
    await f.db.pool.query('UPDATE merchants SET slug=$2 WHERE id=$1', [
      f.merchantId,
      'synthetic',
    ]);
    const verifyBuild = createIndependentBuildVerifier({
      execute,
      bootstrap: async () => bootstrap,
      canonicalBase: async () => hostOrigin,
      previewOrigin,
      executionOrigin,
      record: await createVerifierBuildRecorder(verifierPool),
    });
    const verifierKey = randomBytes(32);
    const capture = await createVerifierCaptureWorker({
      pool: verifierPool,
      hostOrigin,
      previewOrigin,
      bootstrap: async () => bootstrap,
      runner: {
        endpoint: 'https://runner.baci-offline.invalid/v1/execute',
        key,
        toolchainDigest,
        fetch: (url, init) => handler(new Request(url, init)),
      },
    });
    buildVerification = await setupBuildVerification({
      f,
      pool: verifierPool,
      key: verifierKey,
      verify: verifyBuild,
      capture,
      previewOrigin,
    });
    dependencies = {
      profile: 'production',
      previewOrigin,
      hostOrigin,
      key: randomBytes(32),
      toolchainDigest,
      transient: createTransientOutputStore(),
      execute,
      prerenderArtifacts: artifacts,
      bootstrap: async () => bootstrap,
      recordVerifiedEvidence: buildVerification.client,
    };
    const response = await mcp.call('finalize_experience_build', {
      storefrontId: f.merchantId,
      jobId: job.jobId,
      idempotencyKey: randomUUID(),
    });
    expect(response).toMatchObject({ status: 'ok' });
    const build = capturedBuild.value;
    if (!build) throw Error('MCP build did not run');
    expect(response).toMatchObject({
      value: { buildId: build.buildId, buildDigest: build.buildDigest },
    });
    expect(build.proofs).toHaveLength(12);
    expect(new Set(build.proofs.map((proof) => proof.hostOrigin))).toEqual(
      new Set([hostOrigin, previewOrigin])
    );
    expect(build.performance.releaseQualified).toBe(false);
    // Simulate a lost companion after the database commit; retry only repairs it.
    artifacts = createLocalPrerenderArtifacts();
    const repaired = await runExperienceBuild(
      f.owner,
      { jobId: job.jobId, idempotencyKey: randomUUID() },
      { ...dependencies, prerenderArtifacts: artifacts }
    );
    expect(repaired.buildId).toBe(build.buildId);
    expect(repaired.buildDigest).toBe(build.buildDigest);
    expect(repaired.proofs).toHaveLength(0);
    const committed = await f.owner.supabase
      .from('experience_builds')
      .select('id')
      .eq('merchant_id', f.merchantId)
      .eq('job_id', job.jobId);
    expect(committed.error).toBeNull();
    expect(committed.data).toHaveLength(1);

    await checkProductionRunnerPreview({
      f,
      mcp,
      buildId: build.buildId,
      buildVerification,
      capture,
      verifierPool,
      verifierKey,
      key,
      toolchainDigest,
      bootstrap,
      artifacts,
      execute,
      hostOrigin,
      previewOrigin,
      executionOrigin,
      setWebClient: (client) => {
        web.client = client;
      },
    });
  } finally {
    await mcp?.close();
    await buildVerification?.close();
    await verifierPool?.end();
    await f.close();
  }
}, 180000);
