import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { createExperienceEvidenceReader } from '@/lib/experience/evidence-read';
import { createPrivateExperienceCapture } from '@/lib/experience/private-capture-service';
import { createExperienceEvidenceClient } from '../../builder-mcp-server/experience-evidence-client';
import { experienceMcpToolResult } from '../../builder-mcp-server/experience-tool-result';
import { recordLocalMcpEvidence } from './artifact-evidence';
import { runVerifierTransaction } from './verifier-transaction';

vi.mock('server-only', () => ({}));

import { runExperienceBuild } from '@/lib/experience/local-build-supervisor';
import { createExperienceToolDispatcher } from '@/lib/experience/tool-dispatcher';
import { createExperienceGateway } from '@/lib/experience/tool-gateway';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { fixtureCatalog } from '../experience-browser/fixtures/qualification-fixtures';
import { lifecycleDataClient } from './data-client.test-support';
import { hash, lifecycleFixture } from './sql.test-support';

it('normal-auth HTTP upload -> real offline build -> private preview -> owner apply -> unmeasured publication is denied with zero AI calls', async () => {
  const f = await lifecycleFixture();
  const data = await lifecycleDataClient(f);
  try {
    const toolchain = JSON.parse(
      readFileSync(
        new URL(
          '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-b-toolchain.json',
          import.meta.url
        ),
        'utf8'
      )
    ).digest;
    const key = randomBytes(32);
    const provider = vi.fn(() => {
      throw Error('AI_PROVIDER_FORBIDDEN');
    });
    const identity = {
      actorUserId: f.actor,
      connectionId: f.connection,
      grantVersion: 1,
      allowedMerchantIds: [f.merchantId],
      scopes: new Set([
        'storefront.read',
        'storefront.write',
        'storefront.publish',
      ] as const),
      allowCreateStore: false,
    };
    const dispatcher = createExperienceToolDispatcher({
      resolveUserClient: async () => data.client,
      finalizeBuild: async (ctx, input) => {
        const r = await runExperienceBuild(ctx, input, {
          key,
          toolchainDigest: toolchain,
          hostOrigin: 'http://127.0.0.1:4100',
          transient: createTransientOutputStore(),
          bootstrap: {
            catalog: fixtureCatalog,
            capabilities: ['catalog.read', 'navigation'],
            route: {
              epoch: 1,
              routeId: 'home',
              canonicalPath: '/',
              params: {},
              publicDataRevision: fixtureCatalog.revision,
            },
          },
          recordVerifiedEvidence: async (r) => {
            await runVerifierTransaction(f.c, async () => {
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
            });
          },
        });
        return { buildId: r.buildId, buildDigest: r.buildDigest };
      },
      preview: createPrivateExperienceCapture({
        hostOrigin: 'http://127.0.0.1:4100',
        bootstrap: async () => ({
          catalog: fixtureCatalog,
          capabilities: ['catalog.read', 'navigation'],
          route: {
            epoch: 1,
            routeId: 'home',
            canonicalPath: '/',
            params: {},
            publicDataRevision: fixtureCatalog.revision,
          },
        }),
        record: async (r) => {
          await runVerifierTransaction(f.c, async () => {
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
          });
        },
      }),
    });
    const gateway = createExperienceGateway({
      authenticate: async () => identity,
      execute: dispatcher,
    });
    const call = async (name: string, input: Record<string, unknown>) => {
      const r = await gateway(
        new Request('http://127.0.0.1/api', {
          method: 'POST',
          headers: {
            authorization: 'Bearer synthetic.outer',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ storefrontId: f.merchantId, ...input }),
        }),
        name
      );
      expect(r.status).toBe(200);
      const v = await r.json();
      expect(v.status, JSON.stringify(v)).toBe('ok');
      return v.value;
    };
    const program = `import {useState,useRef,useEffect} from 'react';export default function Experience(){const[n,setN]=useState(0);const r=useRef(null);useEffect(()=>{},[]);return <main><h1 ref={r}>Full custom lifecycle</h1><button onClick={()=>setN(n+1)}>Count {n}</button></main>}`;
    const content =
      program +
      '\n/*' +
      'x'.repeat(524288 - Buffer.byteLength(program) - 5) +
      '*/';
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
    for (let offset = 0; offset < Buffer.byteLength(content); offset += 32768) {
      const bytes = Buffer.from(content).subarray(offset, offset + 32768);
      await call('write_experience_chunk', {
        uploadId: upload.uploadId,
        path: 'app.tsx',
        offset,
        bytesBase64: bytes.toString('base64'),
        chunkDigest: hash(bytes),
      });
    }
    const artifact = await call('finalize_experience_upload', {
      uploadId: upload.uploadId,
    });
    const sourceHead = await call('read_experience', {
      operation: 'adopt-upload',
      artifactId: artifact.artifactId,
      baseDigest: artifact.sourceDigest,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    });
    expect(sourceHead).toMatchObject({
      artifactId: artifact.artifactId,
      version: 1,
      conflict: false,
    });
    const job = await call('build_experience', {
      artifactId: artifact.artifactId,
      idempotencyKey: randomUUID(),
    });
    const built = await call('finalize_experience_build', {
      jobId: job.jobId,
      idempotencyKey: randomUUID(),
    });
    expect(built.buildDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (await call('get_experience_operation', { jobId: job.jobId })).status
    ).toBe('finalized');
    const preview = await call('preview_experience', {
      buildId: built.buildId,
      routeId: 'home',
      idempotencyKey: randomUUID(),
    });
    const descriptor = await call('read_experience_evidence', {
      evidenceId: preview.evidenceId,
    });
    const reader = createExperienceEvidenceReader({
      authenticate: async () => identity,
      resolveUserClient: async () => data.client,
    });
    const readImage = createExperienceEvidenceClient({
      fetchImpl: async () =>
        reader(new Request('http://127.0.0.1/evidence'), preview.evidenceId),
    });
    const native = await experienceMcpToolResult(
      'read_experience_evidence',
      { status: 'ok', value: descriptor },
      { token: 'synthetic.outer', evidenceId: preview.evidenceId, readImage }
    );
    const image = native.content?.find((c) => c.type === 'image');
    expect(image?.type).toBe('image');
    if (image?.type === 'image') {
      const png = Buffer.from(image.data, 'base64');
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      await recordLocalMcpEvidence({
        client: data.client,
        merchantId: f.merchantId,
        buildId: built.buildId,
        buildDigest: built.buildDigest,
        sourceDigest: artifact.sourceDigest,
        toolchain,
        manifest,
        source: content,
        png,
      });
    }

    const apply = await call('apply_experience', {
      buildId: built.buildId,
      evidenceId: preview.evidenceId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    });
    await runVerifierTransaction(f.c, async () => {
      await f.c.query(
        "INSERT INTO experience_authorization.approval_checks(intent_id,effect_digest,evidence_digest,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '4 minutes')",
        [apply.approvalId, apply.effectDigest, hash('independent-render')]
      );
    });
    await f.run('experience_confirm_draft_apply', [apply.approvalId]);
    const publicationResponse = await gateway(
      new Request('http://127.0.0.1/api', {
        method: 'POST',
        headers: {
          authorization: 'Bearer synthetic.outer',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          storefrontId: f.merchantId,
          buildId: built.buildId,
          expectedDraftVersion: 1,
          expectedPublishedVersion: 0,
          idempotencyKey: randomUUID(),
        }),
      }),
      'publish_experience'
    );
    expect(publicationResponse.status).toBe(200);
    expect(await publicationResponse.json()).toMatchObject({
      status: 'error',
      code: 'PERFORMANCE_NOT_QUALIFIED',
      reason: 'missing-metrics',
    });
    expect(
      (await f.pool.query('SELECT count(*) FROM experience_published_heads'))
        .rows[0].count
    ).toBe('0');
    expect(provider).not.toHaveBeenCalled();
  } finally {
    await data.close();
    await f.close();
  }
}, 300000);
