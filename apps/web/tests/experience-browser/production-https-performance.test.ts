import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type ExperienceManifest, sourceDigest } from '@baci/shared/experience';
import { expect, it as qualificationTest } from 'vitest';

// Explicit opt-in: requires the separately provisioned local Colima/gVisor fixture.
const it = qualificationTest.skipIf(
  process.env.BACI_LOCAL_EXPERIENCE_QUALIFICATION !== '1'
);

import { measureCandidatePerformance } from '../../src/lib/experience/candidate-performance-measurement';
import { verifyCompiledCandidate } from '../../src/lib/experience/compiled-candidate';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { runLocalQualification } from '../../tools/experience-runner/local-oci-executor';
import { packPrivateBuild } from '../../tools/experience-runner/private-build-payload';

it('measures a prerendered synthetic store over real offline HTTPS at desktop and mobile widths', async () => {
  const font = readFileSync(
    resolve('public/fonts/inter-naira.61440e0f45d4.woff2')
  );
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  );
  const assets = [
    {
      assetId: 'synthetic-image',
      mime: 'image/png' as const,
      bytesBase64: image.toString('base64'),
      digest: digestBytes(image),
    },
    {
      assetId: 'synthetic-font',
      mime: 'font/woff2' as const,
      bytesBase64: font.toString('base64'),
      digest: digestBytes(font),
    },
  ];
  const manifest: ExperienceManifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [
      {
        path: 'app.tsx',
        content: `import {useAssetUrl} from '@baci/experience-sdk'; import './style.css'; export default function Store(){const image=useAssetUrl('synthetic-image');return <main><h1>Synthetic HTTPS storefront</h1><p>Custom authored store, offline Baci preview</p><img src={image??undefined} width="240" height="180" alt="Synthetic product"/><button>Explore products</button></main>}`,
      },
      {
        path: 'style.css',
        content: `@font-face{font-family:Synthetic;src:url('/assets/synthetic-font') format('woff2');font-display:swap}body{margin:0;font-family:Synthetic,system-ui;background:#f5f0e8;color:#172319}main{padding:24px;max-width:900px;margin:auto}h1{font-size:clamp(28px,5vw,56px)}img{display:block;object-fit:cover;background:#d2dfcc}button{margin-top:16px;padding:16px}`,
      },
    ],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    capabilities: ['navigation', 'catalog.read'],
    assets: assets.map(({ assetId }) => ({
      assetId,
      alt: 'Synthetic HTTPS asset',
    })),
  };
  const hostOrigin = 'https://merchant.synthetic.test';
  const built = await runLocalQualification(
    'prerender-build',
    packPrivateBuild(manifest, hostOrigin, 'production')
  );
  const compiled = built.output as { client: unknown; renderer: unknown };
  const client = verifyCompiledCandidate(compiled.client);
  const renderer = verifyCompiledCandidate(compiled.renderer);
  const result = await measureCandidatePerformance({
    execute: runLocalQualification,
    manifest,
    candidate: { ...client, hostOrigin },
    renderer: { ...renderer, hostOrigin },
    rendererKind: 'prerender',
    assets,
    sourceDigest: sourceDigest(manifest),
    bootstrap: async () => ({
      route: {
        epoch: 1,
        routeId: 'home',
        canonicalPath: '/',
        params: {},
        publicDataRevision: 'synthetic',
      },
      catalog: { revision: 'synthetic', products: [] },
      capabilities: manifest.capabilities,
    }),
    // Functional transport proof only: retain worker contamination and report actual host load separately.
    hostContaminated: () => false,
  });
  const directory = resolve(
    '../../docs/connectors/evidence/experience-https-cwv-20261103'
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'synthetic-tls-samples.json'),
    `${JSON.stringify(
      {
        purpose:
          'functional offline HTTPS transport proof; not clean-host or field qualification',
        ...result,
      },
      null,
      2
    )}\n`
  );
  expect(result.report?.samples).toHaveLength(6);
  for (const sample of result.report?.samples ?? []) {
    expect(sample.diagnostics).toMatchObject({
      transport: 'https-loopback-tls',
    });
    expect(sample.diagnostics?.tlsConnections).toBeGreaterThanOrEqual(2);
    expect(sample.consoleErrors).toBe(0);
    expect(sample.contentVisible).toBe(true);
    expect(sample.imagesDecoded).toBe(true);
    expect(sample.frameLcpMs).toBeGreaterThan(0);
  }
  expect(result.report?.cwvQualified).toBe(false);
  expect(result.report?.releaseQualified).toBe(false);
}, 180000);
