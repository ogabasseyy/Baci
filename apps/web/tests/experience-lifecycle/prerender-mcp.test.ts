import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PublicBootstrap } from '@baci/shared/experience';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createLocalPrerenderPipeline } from '@/lib/experience/local-prerender-pipeline';
import type { createPreviewLaunch } from '@/lib/experience/preview-launch';
import { createPreviewVault } from '@/lib/experience/preview-service';
import { createPrivateExperienceCapture } from '@/lib/experience/private-capture-service';
import { createExperienceToolDispatcher } from '@/lib/experience/tool-dispatcher';
import { createExperienceGateway } from '@/lib/experience/tool-gateway';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { fixtureCatalog } from '../experience-browser/fixtures/qualification-fixtures';
import { lifecycleDataClient } from './data-client.test-support';
import { hash, lifecycleFixture } from './sql.test-support';
import { runVerifierTransaction } from './verifier-transaction';

it('normal-auth MCP upload/build/preview retains and serves full prerender HTML with fresh data and revocation, without publishing', async () => {
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'baci-mcp-durable-'));
  const f = await lifecycleFixture();
  await f.pool.query(
    readFileSync(
      new URL(
        '../../../../supabase/migrations/20261024074638_experience_private_preview.sql',
        import.meta.url
      ),
      'utf8'
    )
  );
  const data = await lifecycleDataClient(f);
  try {
    const hostOrigin = 'http://127.0.0.1:4100';
    const identity = {
      actorUserId: f.actor,
      connectionId: f.connection,
      grantVersion: 1,
      allowedMerchantIds: [f.merchantId],
      scopes: new Set(['storefront.read', 'storefront.write'] as const),
      allowCreateStore: false,
    };
    let price = 250;
    const bootstrap = async (): Promise<PublicBootstrap> => ({
      catalog: {
        ...fixtureCatalog,
        products: fixtureCatalog.products.map((p) => ({
          ...p,
          currency: 'NGN',
          price,
        })),
      },
      currency: 'NGN',
      capabilities: ['catalog.read', 'navigation'],
      route: {
        epoch: 1,
        routeId: 'home' as const,
        canonicalPath: '/',
        params: {},
        publicDataRevision: String(price),
      },
    });
    const vault = createPreviewVault({
      origin: 'http://127.0.0.1:4101',
      now: Date.now,
      isActive: async (bindingId) => {
        const r = await data.client.rpc('experience_preview_binding_active', {
          p_binding: bindingId,
        });
        if (r.error) throw Error('NOT_FOUND');
        return r.data === true;
      },
    });
    const settings: Parameters<typeof createLocalPrerenderPipeline>[0] = {
      artifactDirectory,
      canonicalBase: `${hostOrigin}/qa1`,
      vault,
      bootstrap,
      build: {
        key: randomBytes(32),
        toolchainDigest: hash('local-prerender-v1'),
        hostOrigin,
        transient: createTransientOutputStore(),
        recordVerifiedEvidence: async (r) =>
          runVerifierTransaction(f.c, async () => {
            await f.c.query(
              'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
              [
                r.merchantId,
                r.jobId,
                r.attemptNonce,
                r.buildDigest,
                r.receiptDigest,
                r.hostOrigin,
              ]
            );
          }),
      },
    };
    const pipeline = createLocalPrerenderPipeline(settings);
    const dispatcher = createExperienceToolDispatcher({
      resolveUserClient: async () => data.client,
      rendering: pipeline.rendering,
      finalizeBuild: pipeline.finalizeBuild,
      readPerformance: pipeline.readPerformance,
      preview: createPrivateExperienceCapture({
        hostOrigin,
        bootstrap,
        record: async (r) =>
          runVerifierTransaction(f.c, async () => {
            await f.c.query(
              'INSERT INTO experience_snapshots(id,merchant_id,build_id,build_digest,key_digest,snapshot_key,catalog_revision,consumes_catalog,nodes,evidence_digest,evidence_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10)',
              [
                r.id,
                r.merchantId,
                r.buildId,
                r.buildDigest,
                r.keyDigest,
                r.snapshot.key,
                fixtureCatalog.revision,
                JSON.stringify(r.snapshot.nodes),
                r.evidenceDigest,
                Buffer.from(r.bytes),
              ]
            );
          }),
      }),
    });
    const gateway = createExperienceGateway({
      authenticate: async () => identity,
      execute: dispatcher,
    });
    const call = async (name: string, input: Record<string, unknown>) => {
      const response = await gateway(
        new Request('http://127.0.0.1/api', {
          method: 'POST',
          headers: {
            authorization: 'Bearer local.synthetic',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ storefrontId: f.merchantId, ...input }),
        }),
        name
      );
      const result = await response.json();
      expect(result.status, JSON.stringify(result)).toBe('ok');
      return result.value;
    };
    expect(
      (await call('get_experience_capabilities', {})).performance
        .runtimeRendering
    ).toBe('prerender-private');
    const content =
      "import {useState} from 'react';export default function Store({catalog}){const[n,setN]=useState(0);return <main><h1>Full custom prerender</h1><p>NGN {catalog.products[0]?.price}</p><button onClick={()=>setN(n+1)}>Count {n}</button></main>}";
    const manifest = {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [{ path: 'app.tsx', content: '' }],
      packages: [{ name: 'react', versionRef: 'platform-pinned' }],
      routes: [{ path: '/', view: 'home' }],
      assets: [],
      capabilities: ['catalog.read', 'navigation'],
    };
    const upload = await call('begin_experience_upload', {
      manifest,
      files: {
        files: [
          {
            path: 'app.tsx',
            bytes: Buffer.byteLength(content),
            digest: hash(content),
          },
        ],
      },
    });
    await call('write_experience_chunk', {
      uploadId: upload.uploadId,
      path: 'app.tsx',
      offset: 0,
      bytesBase64: Buffer.from(content).toString('base64'),
      chunkDigest: hash(content),
    });
    const artifact = await call('finalize_experience_upload', {
      uploadId: upload.uploadId,
    });
    const job = await call('build_experience', {
      artifactId: artifact.artifactId,
      idempotencyKey: randomUUID(),
    });
    const built = await call('finalize_experience_build', {
      jobId: job.jobId,
      idempotencyKey: randomUUID(),
    });
    const preview = await call('preview_experience', {
      buildId: built.buildId,
      routeId: 'home',
      idempotencyKey: randomUUID(),
    });
    expect(preview.previewUrl).toContain('/builder/experience/preview');
    const measured = await call('read_experience_performance', {
      buildId: built.buildId,
    });
    expect(measured.buildId).toBe(built.buildId);
    expect(measured.qualification.cwvQualified).toBe(false);
    expect(measured.qualification.releaseQualified).toBe(false);
    if (measured.status === 'lab-only') {
      expect(measured.report.buildDigest).toBe(built.buildDigest);
      expect(measured.report.sourceDigest).toBe(artifact.sourceDigest);
      expect(measured.report.bootstrapDigests).toHaveLength(1);
    }
    price = 320;
    const stale = await call('read_experience_performance', {
      buildId: built.buildId,
    });
    expect(stale.status).toBe('not-measured');
    const ownerContext = {
      merchantId: f.merchantId,
      supabase: data.client,
      identity,
    };
    const restored = createLocalPrerenderPipeline(settings);
    const launch = (await restored.owner.createPreviewLaunch(ownerContext, {
      buildId: built.buildId,
      routeId: 'home',
    })) as Awaited<ReturnType<typeof createPreviewLaunch>>;
    expect('renderMode' in launch && launch.renderMode).toBe('prerender');
    const ticket = new URL(launch.src).pathname.split('/')[2];
    const html = Buffer.from(
      (await vault.read(ticket, 'index.html')).bytes
    ).toString();
    expect(html).toContain('<h1>Full custom prerender</h1>');
    expect(html).toMatch(/NGN (?:<!-- -->)?320/);
    expect(html).toContain('baci-prerender-bootstrap');
    const root = new URL(
      '../../../../.superpowers/sdd/2026-10-25-experience-prerender-mcp/',
      import.meta.url
    );
    mkdirSync(root, { recursive: true });
    const files = [];
    for (const resource of launch.resources) {
      const file = await vault.read(resource.ticket, resource.path);
      files.push({
        url: resource.url,
        mime: file.mime,
        bytes: Buffer.from(file.bytes).toString('base64'),
      });
    }
    writeFileSync(
      new URL('private-launch.json', root),
      JSON.stringify({
        src: launch.src,
        html,
        files,
        bootstrap: 'bootstrap' in launch ? launch.bootstrap : undefined,
        buildDigest: built.buildDigest,
        sourceDigest: artifact.sourceDigest,
        hostOrigin,
      })
    );
    await f.run('disconnect_builder_connection', [f.connection]);
    await expect(vault.read(ticket, 'index.html')).rejects.toThrow(
      'LAUNCH_EXPIRED'
    );
    await expect(
      pipeline.owner.createPreviewLaunch(ownerContext, {
        buildId: built.buildId,
        routeId: 'home',
      })
    ).rejects.toThrow();
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('0');
  } finally {
    await data.close();
    await f.close();
    rmSync(artifactDirectory, { recursive: true, force: true });
  }
});
