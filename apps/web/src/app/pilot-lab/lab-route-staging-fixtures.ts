import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLabConfig } from '@/lib/merchant-image-variant-pilot/lab-config';
import { labGenerationIdFor } from '@/lib/merchant-image-variant-pilot/lab-generation-identity';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import {
  parseRawAcceptances,
  parseRawInventoryRecords,
} from './lab-route-records';
import { seedCommittedFillers } from './lab-test-roots';

// Route-staging fixtures shared by the staging suites: input/output
// roots with a bound logo generation plus the stage-into-public
// helper. Split from lab-route-staging.test.ts under the repo line
// ceiling; test support, exercised through the suites (no colocated
// test, like the tools/perf *-fixtures modules).

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);

export const ROUTE_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

export async function stageRouteFiles(lab: {
  inputRoot: string;
  outputRoot: string;
  publicDir: string;
}) {
  const inventoryText = await readFile(
    join(lab.inputRoot, 'inventory.json'),
    'utf8'
  );
  const acceptancesText = await readFile(
    join(lab.outputRoot, 'acceptances.json'),
    'utf8'
  );
  await loadLabConfig(
    {
      acceptances: parseRawAcceptances(JSON.parse(acceptancesText)),
      inputRoot: lab.inputRoot,
      inventoryRecords: parseRawInventoryRecords(JSON.parse(inventoryText)),
      outputRoot: lab.outputRoot,
      publicDir: lab.publicDir,
    },
    { stage: true }
  );
  await seedCommittedFillers(lab.publicDir);
}

export async function setupRouteFiles() {
  const base = await mkdtemp(join(tmpdir(), 'pilot-route-'));
  const inputRoot = join(base, 'input');
  const outputRoot = join(base, 'output');
  const publicDir = join(base, 'public');
  await mkdir(inputRoot, { recursive: true });

  const snapshot = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
  await writeFile(join(inputRoot, 'logo-1.png'), snapshot);
  const sourceSha256 = createHash('sha256').update(snapshot).digest('hex');
  // The bound recipe output for this fixture job: buildLabIndex
  // recomputes it and rejects renamed directories.
  const generationId = labGenerationIdFor({
    assetId: 'logo-1',
    encoderIdentity: {
      libvipsVersion: '8.18.6',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
    merchantId: ROUTE_MERCHANT,
    recipeId: PILOT_RECIPE_ID,
    role: 'logo',
    sourceSha256,
  });
  const generationDir = join(outputRoot, 'generations', generationId);
  await mkdir(generationDir, { recursive: true });

  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp'] as const) {
      const bytes = Buffer.concat([
        snapshot,
        Buffer.from(`${requestedWidth}${format}`),
      ]);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const fileName = `${hash}.${format}`;
      await writeFile(join(generationDir, fileName), bytes);
      tiers.push({
        actualWidth: 48,
        bytes: bytes.length,
        contentType: `image/${format}`,
        // Synthetic tiers exceed the 85-byte snapshot from a png source:
        // the explicit over-source exception (never forced into a cap).
        delivery: 'generated-over-source',
        format,
        height: 48,
        path: fileName,
        quality: 70,
        requestedWidth,
        sha256: hash,
        width: 48,
      });
    }
  }
  await writeFile(
    join(generationDir, 'manifest.json'),
    JSON.stringify({
      assetId: 'logo-1',
      createdAt: '2026-10-01T20:00:00.000Z',
      encoder: {
        libvipsVersion: '8.18.6',
        name: 'sharp',
        sharpVersion: '0.35.4',
      },
      merchantId: ROUTE_MERCHANT,
      policyVersion: 1,
      recipeId: PILOT_RECIPE_ID,
      role: 'logo',
      schemaVersion: 1,
      source: {
        bytes: snapshot.length,
        format: 'png',
        orientedHeight: 48,
        orientedWidth: 48,
        sha256: sourceSha256,
      },
      tiers,
    })
  );
  await writeFile(
    join(outputRoot, 'acceptances.json'),
    JSON.stringify([
      {
        assetId: 'logo-1',
        generationId,
        merchantId: ROUTE_MERCHANT,
        note: 'Lab review passed.',
        outputHashes: tiers.map((tier) => tier.sha256),
        qualities: tiers.map((tier) => tier.quality),
        originalUrl: 'https://cdn.example.com/media/logo.png',
        recipeId: PILOT_RECIPE_ID,
        reviewedAt: '2026-10-01T21:00:00.000Z',
        reviewer: 'pilot-owner',
        schemaVersion: 1,
        slotId: 'header-logo',
        sourceSha256,
        verdict: 'accepted',
      },
    ])
  );
  await writeFile(
    join(inputRoot, 'inventory.json'),
    JSON.stringify([
      {
        assetId: 'logo-1',
        merchantId: ROUTE_MERCHANT,
        role: 'logo',
        schemaVersion: 1,
        sha256: sourceSha256,
        slot: 'header-logo',
        sourcePath: 'logo-1.png',
        url: 'https://cdn.example.com/media/logo.png',
      },
    ])
  );
  return { inputRoot, outputRoot, publicDir };
}
