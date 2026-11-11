import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { queueExperienceBuild } from '@/lib/experience/build-service';
import { runExperienceBuild } from '@/lib/experience/local-build-supervisor';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { createPreviewLaunch } from '@/lib/experience/preview-launch';
import { createPreviewVault } from '@/lib/experience/preview-service';
import {
  beginUpload,
  finalizeUpload,
  writeChunk,
} from '@/lib/experience/upload-service';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { createLocalPrerenderArtifacts } from '../../tools/experience-runner/prerender-artifacts';
import { createProductionPreviewDelivery } from '../../tools/experience-runner/preview-delivery';
import {
  createRunnerExecutor,
  createRunnerHandler,
} from '../../tools/experience-runner/runner-transport';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { runVerifierTransaction } from '../experience-lifecycle/verifier-transaction';
import { experienceDataFixture } from './data-fixture.test-support';
import { launchThroughOwnerBridge } from './production-preview-bridge.test-support';

it('normal owner RLS -> signed runner -> offline HTTPS browser matrix -> private prerender delivery -> revocation, with no publication', async () => {
  const f = await experienceDataFixture();
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
    const upload = await beginUpload(f.owner, {
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
    });
    await writeChunk(f.owner, {
      uploadId: upload.uploadId,
      path: 'app.tsx',
      offset: 0,
      bytes: Buffer.from(content),
      chunkDigest: digestBytes(content),
    });
    const artifact = await finalizeUpload(f.owner, upload);
    const job = await queueExperienceBuild(f.owner, {
      artifactId: artifact.artifactId,
      idempotencyKey: randomUUID(),
    });
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
    const dependencies: Parameters<typeof runExperienceBuild>[2] = {
      profile: 'production',
      previewOrigin,
      hostOrigin,
      key: randomBytes(32),
      toolchainDigest,
      transient: createTransientOutputStore(),
      execute,
      prerenderArtifacts: artifacts,
      bootstrap: async () => bootstrap,
      recordVerifiedEvidence: async (receipt) => {
        const client = await f.db.pool.connect();
        try {
          await runVerifierTransaction(client, () =>
            client.query(
              'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
              [
                receipt.merchantId,
                receipt.jobId,
                receipt.attemptNonce,
                receipt.buildDigest,
                receipt.receiptDigest,
                receipt.hostOrigin,
              ]
            )
          );
        } finally {
          client.release();
        }
      },
    };
    const build = await runExperienceBuild(
      f.owner,
      { jobId: job.jobId, idempotencyKey: randomUUID() },
      dependencies
    );
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

    const vault = createPreviewVault({
      origin: executionOrigin,
      now: Date.now,
      isActive: async (binding) => {
        const result = await f.anonymous.rpc(
          'experience_preview_binding_active',
          { p_binding: binding }
        );
        return !result.error && result.data === true;
      },
    });
    const prerender = {
      artifacts,
      execute,
      executionOrigin,
      bootstrap: async () => bootstrap,
    };
    await expect(
      createPreviewLaunch(
        f.other,
        { buildId: build.buildId, routeId: 'home' },
        vault,
        hostOrigin,
        prerender
      )
    ).rejects.toThrow('NOT_FOUND');
    const launch = await launchThroughOwnerBridge({
      fixture: f,
      vault,
      hostOrigin,
      previewOrigin,
      buildId: build.buildId,
      prerender,
    });
    const delivery = createProductionPreviewDelivery({
      vault,
      executionOrigin,
      hostOrigins: [hostOrigin],
    });
    expect(
      (
        await f.anonymous
          .from('experience_preview_bindings')
          .select('id')
          .limit(1)
      ).error
    ).not.toBeNull();
    const html = await delivery(new Request(launch.src));
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('Synthetic Orbit production ports');
    await f.db.pool.query('DELETE FROM auth.sessions WHERE id=$1', [
      f.sessionId,
    ]);
    expect((await delivery(new Request(launch.src))).status).toBe(404);
    expect(
      (await f.db.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('0');
  } finally {
    await f.close();
  }
}, 180000);

it('keeps canonical HTTPS SQL origins strict without changing local support', async () => {
  const f = await experienceDataFixture();
  try {
    const origins = [
      'https://shop.synthetic.test',
      'https://shop.synthetic.test:8443',
      'http://127.0.0.1:4102',
      'http://public.example.test',
      'https://user:password@shop.synthetic.test',
      'https://shop.synthetic.test/path',
      'https://shop.synthetic.test:443',
      'https://shop.synthetic.test:65536',
      'https://shop.synthetic.test;bad',
      'https://127.0.0.1',
    ];
    const validity = await f.db.pool.query(
      'SELECT public.experience_host_origin_valid(value) AS valid FROM unnest($1::text[]) WITH ORDINALITY AS origins(value, n) ORDER BY n',
      [origins]
    );
    expect(validity.rows.map((row) => row.valid)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  } finally {
    await f.close();
  }
});
