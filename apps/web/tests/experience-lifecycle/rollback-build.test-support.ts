import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import type { SupabaseClient } from '@supabase/supabase-js';
import { queueExperienceBuild } from '@/lib/experience/build-service';
import { runExperienceBuild } from '@/lib/experience/local-build-supervisor';
import { adoptSourceCandidate } from '@/lib/experience/source-candidate';
import {
  beginUpload,
  finalizeUpload,
  writeChunk,
} from '@/lib/experience/upload-service';
import { captureExperience } from '../../tools/experience-runner/capture-route';
import { createTransientOutputStore } from '../../tools/experience-runner/transient-output-store';
import { fixtureCatalog } from '../experience-browser/fixtures/qualification-fixtures';
import { hash, type lifecycleFixture } from './sql.test-support';
export const rollbackFolder = new URL(
  '../../../../.superpowers/sdd/experience-rollback-output/',
  import.meta.url
);
const routes: ExperienceManifest['routes'] = [
  { path: '/', view: 'home' },
  { path: '/collections/all', view: 'collection' },
  { path: '/products/device', view: 'product' },
  { path: '/pages/story', view: 'editorial' },
];
function bootstrap(path = '/'): PublicBootstrap {
  return {
    catalog: fixtureCatalog,
    capabilities: ['catalog.read', 'navigation'],
    route: {
      epoch: 1,
      routeId: routes.find((r) => r.path === path)?.view ?? 'home',
      canonicalPath: path,
      params: {},
      publicDataRevision: fixtureCatalog.revision,
    },
  };
}
export async function buildRollbackArtifact(
  f: Awaited<ReturnType<typeof lifecycleFixture>>,
  client: SupabaseClient,
  label: 'previous' | 'current',
  expectedVersion: number,
  baseDigest?: string
) {
  const ctx = { merchantId: f.merchantId, supabase: client };
  const source = `import {useState} from 'react'; import {useCommerce} from '@baci/experience-sdk'; export default function Store({route,catalog}){const commerce=useCommerce();const[n,setN]=useState(0);return <main><h1>Synthetic rollback ${label}</h1><p>{route.canonicalPath}</p><p>{catalog.products[0].name}</p><button onClick={()=>setN(n+1)}>Count {n}</button><nav>{['/','/collections/all','/products/device','/pages/story'].map(path=><button key={path} onClick={()=>commerce.navigation.go(path)}>{path}</button>)}</nav></main>}`;
  const manifest: ExperienceManifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [{ path: 'app.tsx', content: '' }],
    packages: [
      { name: 'react', versionRef: 'platform-pinned' },
      { name: '@baci/experience-sdk', versionRef: 'platform-pinned' },
    ],
    routes,
    assets: [],
    capabilities: ['catalog.read', 'navigation'],
  };
  const upload = await beginUpload(ctx, {
    manifest,
    files: {
      files: [
        {
          path: 'app.tsx',
          bytes: Buffer.byteLength(source),
          digest: hash(source),
        },
      ],
    },
  });
  await writeChunk(ctx, {
    uploadId: upload.uploadId,
    path: 'app.tsx',
    offset: 0,
    bytes: Buffer.from(source),
    chunkDigest: hash(source),
  });
  const artifact = await finalizeUpload(ctx, upload);
  const adopted = await adoptSourceCandidate(ctx, {
    artifactId: artifact.artifactId,
    baseDigest: baseDigest ?? artifact.sourceDigest,
    expectedVersion,
    idempotencyKey: randomUUID(),
  });
  if (adopted.conflict) throw Error('SOURCE_CONFLICT');
  const job = await queueExperienceBuild(ctx, {
    artifactId: artifact.artifactId,
    idempotencyKey: randomUUID(),
  });
  const toolchain = JSON.parse(
    readFileSync(
      new URL(
        '../../../../.superpowers/sdd/2026-10-23-full-code-experiences/checkpoint-b-toolchain.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const built = await runExperienceBuild(
    ctx,
    { jobId: job.jobId, idempotencyKey: randomUUID() },
    {
      key: randomBytes(32),
      toolchainDigest: toolchain.digest,
      hostOrigin: 'http://127.0.0.1:4100',
      transient: createTransientOutputStore(),
      bootstrap: bootstrap(),
      recordVerifiedEvidence: async (proof) => {
        await f.c.query('BEGIN');
        try {
          await f.c.query('SET LOCAL ROLE baci_experience_verifier');
          await f.c.query(
            'INSERT INTO experience_evidence(merchant_id,job_id,attempt_nonce,build_digest,receipt_digest,host_origin) VALUES($1,$2,$3,$4,$5,$6)',
            [
              proof.merchantId,
              proof.jobId,
              proof.attemptNonce,
              proof.buildDigest,
              proof.receiptDigest,
              proof.hostOrigin,
            ]
          );
          await f.c.query('COMMIT');
        } catch (error) {
          await f.c.query('ROLLBACK');
          throw error;
        }
      },
    }
  );
  const read = await client
    .from('experience_build_files')
    .select('path,bytes,digest')
    .eq('merchant_id', f.merchantId)
    .eq('build_id', built.buildId);
  if (read.error || read.data?.length !== 2) throw Error('RETENTION_FAILED');
  const outputs = new Map<string, string>();
  const folder = new URL(`${label}/`, rollbackFolder);
  mkdirSync(folder, { recursive: true });
  for (const file of read.data) {
    if (!['app.js', 'app.css'].includes(file.path))
      throw Error('RETENTION_FAILED');
    const bytes = Buffer.from(file.bytes.slice(2), 'hex');
    if (hash(bytes) !== file.digest) throw Error('RETENTION_FAILED');
    outputs.set(file.path, bytes.toString('utf8'));
    writeFileSync(new URL(file.path, folder), bytes);
  }
  const javascript = outputs.get('app.js');
  const css = outputs.get('app.css');
  if (
    !javascript ||
    css === undefined ||
    hash(`${javascript}\0${css}`) !== built.buildDigest
  )
    throw Error('RETENTION_FAILED');
  const captures = [];
  for (const route of routes) {
    const result = await captureExperience({
      manifest,
      hostOrigin: 'http://127.0.0.1:4100',
      bundle: { javascript, css, digest: built.buildDigest },
      bootstrap: bootstrap(route.path),
      assets: [],
      engine: 'chromium',
      width: 390,
      assetsDigest: hash('[]'),
    });
    const png = Buffer.from(result.evidence.bytes);
    const file = `${route.view}.png`;
    writeFileSync(new URL(file, folder), png);
    captures.push({
      path: route.path,
      file,
      pngDigest: hash(png),
      snapshot: result.snapshot,
      jobId: result.jobId,
    });
  }
  const evidence = await client
    .from('experience_evidence')
    .select('id')
    .eq('merchant_id', f.merchantId)
    .eq('job_id', job.jobId)
    .single();
  if (evidence.error || !evidence.data) throw Error('EVIDENCE_MISSING');
  const receipt = {
    label,
    buildId: built.buildId,
    buildDigest: built.buildDigest,
    artifactId: artifact.artifactId,
    sourceDigest: artifact.sourceDigest,
    toolchain,
    manifest: { ...manifest, files: [{ path: 'app.tsx', content: source }] },
    outputs: read.data.map(({ path, digest }) => ({ path, digest })),
    independentProofs: built.proofs,
    captures,
    normalOwnerRlsReads: true,
  };
  writeFileSync(new URL('source.tsx', folder), source);
  writeFileSync(
    new URL('manifest.json', folder),
    `${JSON.stringify(receipt, null, 2)}\n`
  );
  return {
    id: built.buildId,
    evidence: evidence.data.id,
    artifact: artifact.artifactId,
    digest: built.buildDigest,
    sourceDigest: artifact.sourceDigest,
    marker: hash(JSON.stringify(captures)),
    receipt,
  };
}
