import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { ExperienceManifest } from '@baci/shared/experience';
import sharp from 'sharp';
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { loadOfflineAssets, storeAsset } from '@/lib/experience/asset-service';
import {
  queueExperienceBuild,
  readExperienceOperation,
} from '@/lib/experience/build-service';
import { runExperienceBuild } from '@/lib/experience/local-build-supervisor';
import { digestBytes } from '@/lib/experience/manifest-digest';
import { createPreviewLaunch } from '@/lib/experience/preview-launch';
import { createPreviewVault } from '@/lib/experience/preview-service';
import {
  beginUpload,
  finalizeUpload,
  writeChunk,
} from '@/lib/experience/upload-service';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { fixtureCatalog } from '../experience-browser/fixtures/qualification-fixtures';
import { runVerifierTransaction } from '../experience-lifecycle/verifier-transaction';
import { experienceDataFixture } from './data-fixture.test-support';

it('private-lifecycle normal owner upload -> isolated independent builds/render proof -> durable finalize -> owner preview/session revocation', async () => {
  const f = await experienceDataFixture();
  try {
    const image = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#3355aa' },
    })
      .png()
      .toBuffer();
    const design = await storeAsset(
      f.owner,
      { mime: 'image/png', bytes: image, alt: 'Synthetic blue design' },
      'design'
    );
    const referenceImage = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#aa5533' },
    })
      .png()
      .toBuffer();
    const reference = await storeAsset(
      f.owner,
      {
        mime: 'image/png',
        bytes: referenceImage,
        alt: 'Private synthetic reference',
      },
      'reference'
    );
    await expect(
      loadOfflineAssets(f.owner, [reference.assetId])
    ).rejects.toThrow('NOT_FOUND');
    const font = await storeAsset(
      f.owner,
      {
        mime: 'font/woff2',
        bytes: readFileSync(
          new URL(
            '../../public/fonts/inter-naira.61440e0f45d4.woff2',
            import.meta.url
          )
        ),
        alt: 'Offline synthetic font',
      },
      'design'
    );
    const css = `@font-face{font-family:CheckpointAsset;src:url('/assets/${font.assetId}') format('woff2')}body{font-family:CheckpointAsset,sans-serif}img{width:32px;height:24px}`;
    const content = `import './style.css';import {useAssetUrl} from '@baci/experience-sdk';export default function Experience({route}:{route:{routeId:string}}){const image=useAssetUrl('${design.assetId}');return <main><h1>Synthetic private lifecycle · {route.routeId}</h1><img src={image??undefined} alt="Synthetic blue design"/><p>Full custom component; no live commerce.</p></main>}`;
    const manifest: ExperienceManifest = {
      format: 'baci.experience/v2',
      runtime: 'react-browser-sandbox/v1',
      sdkVersion: 'commerce-bridge/v1',
      entry: 'app.tsx',
      files: [
        { path: 'app.tsx', content: '' },
        { path: 'style.css', content: '' },
      ],
      packages: [],
      routes: [
        { path: '/', view: 'home' },
        { path: '/collections/[handle]', view: 'collection' },
        { path: '/products/[handle]', view: 'product' },
        { path: '/journal/[handle]', view: 'editorial' },
      ],
      assets: [
        { assetId: design.assetId, alt: 'Synthetic blue design' },
        { assetId: font.assetId, alt: 'Offline synthetic font' },
      ],
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
          {
            path: 'style.css',
            bytes: Buffer.byteLength(css),
            digest: digestBytes(css),
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
    await writeChunk(f.owner, {
      uploadId: upload.uploadId,
      path: 'style.css',
      offset: 0,
      bytes: Buffer.from(css),
      chunkDigest: digestBytes(css),
    });
    const artifact = await finalizeUpload(f.owner, upload);
    const job = await queueExperienceBuild(f.owner, {
      artifactId: artifact.artifactId,
      idempotencyKey: randomUUID(),
    });
    expect((await readExperienceOperation(f.owner, job.jobId)).status).toBe(
      'queued'
    );
    const built = await runExperienceBuild(
      f.owner,
      { jobId: job.jobId, idempotencyKey: randomUUID() },
      {
        key: randomBytes(32),
        hostOrigin: 'http://127.0.0.1:4102',
        toolchainDigest: JSON.parse(
          readFileSync(
            new URL(
              '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-b-toolchain.json',
              import.meta.url
            ),
            'utf8'
          )
        ).digest,
        transient: createTransientOutputStore(),
        bootstrap: {
          catalog: fixtureCatalog,
          capabilities: manifest.capabilities,
          route: {
            epoch: 1,
            routeId: 'home',
            canonicalPath: '/',
            params: {},
            publicDataRevision: fixtureCatalog.revision,
          },
        },
        recordVerifiedEvidence: async (r) => {
          const client = await f.db.pool.connect();
          try {
            await runVerifierTransaction(client, async () => {
              await client.query(
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
            });
          } finally {
            client.release();
          }
        },
      }
    );
    expect(built.proofs).toHaveLength(6);
    expect((await readExperienceOperation(f.owner, job.jobId)).status).toBe(
      'finalized'
    );
    const vault = createPreviewVault({
      now: Date.now,
      origin: 'http://127.0.0.1:4101',
      isActive: async (id) => {
        const { data, error } = await f.owner.supabase.rpc(
          'experience_preview_binding_active',
          { p_binding: id }
        );
        return !error && data === true;
      },
    });
    await expect(
      createPreviewLaunch(
        f.other,
        { buildId: built.buildId, routeId: 'home' },
        vault
      )
    ).rejects.toThrow('NOT_FOUND');
    const launch = await createPreviewLaunch(
      f.owner,
      { buildId: built.buildId, routeId: 'home' },
      vault
    );
    const file = launch.resources.find((f) => f.path === 'app.js');
    if (!file) throw Error('Missing compiled JS');
    expect(
      (await vault.read(file.ticket, file.path)).bytes.length
    ).toBeGreaterThan(0);
    await f.db.pool.query('DELETE FROM auth.sessions WHERE id=$1', [
      f.sessionId,
    ]);
    await expect(vault.read(file.ticket, file.path)).rejects.toThrow(
      'LAUNCH_EXPIRED'
    );
    expect(
      (
        await f.db.pool.query(
          'SELECT count(*) FROM experience_build_files WHERE build_id=$1',
          [built.buildId]
        )
      ).rows[0].count
    ).toBe('2');
    writeFileSync(
      new URL(
        '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/b-private-lifecycle-receipt.json',
        import.meta.url
      ),
      JSON.stringify(
        {
          sourceDigest: artifact.sourceDigest,
          buildDigest: built.buildDigest,
          proofs: built.proofs,
          normalRoleRls: true,
          privateReferenceDenied: true,
          sessionRevocationEnforced: true,
          designAssets: [design.digest, font.digest],
          publishedHeads: (
            await f.db.pool.query(
              'SELECT count(*) FROM experience_published_heads'
            )
          ).rows[0].count,
        },
        null,
        2
      )
    );
  } finally {
    await f.close();
  }
}, 180000);
