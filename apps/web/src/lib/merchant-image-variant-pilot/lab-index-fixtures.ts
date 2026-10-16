import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { labGenerationIdFor } from './lab-generation-identity';

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

export const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
export const SOURCE =
  'd9ffc58df5cc06104ae0eb604f84606549e8e6b5d06a35bff668c1f2e3511b98';
// The bound recipe output for the fixture job: buildLabIndex recomputes
// this from (job, recipe, encoder, source) and rejects renamed dirs.
export const GENERATION_ID = labGenerationIdFor({
  assetId: 'logo-1',
  encoderIdentity: {
    libvipsVersion: '8.18.6',
    name: 'sharp',
    sharpVersion: '0.35.4',
  },
  merchantId: MERCHANT,
  recipeId: PILOT_RECIPE_ID,
  role: 'logo',
  sourceSha256: SOURCE,
});

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function setupLab(
  options: {
    manifest?: Record<string, unknown>;
    acceptance?: Record<string, unknown>;
    tamper?: string;
    skipManifest?: boolean;
    generationId?: string;
  } = {}
) {
  const base = join(
    tmpdir(),
    `pilot-lab-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const outputRoot = join(base, 'output');
  const generationId = options.generationId ?? GENERATION_ID;
  const generationDir = join(outputRoot, 'generations', generationId);
  await mkdir(generationDir, { recursive: true });
  const payload = await readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));

  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp'] as const) {
      const bytes = Buffer.concat([
        payload,
        Buffer.from(`${requestedWidth}${format}`),
      ]);
      const hash = sha256(bytes);
      const fileName = `${hash}.${format}`;
      await writeFile(join(generationDir, fileName), bytes);
      tiers.push({
        actualWidth: 48,
        bytes: bytes.length,
        contentType: `image/${format}`,
        // Current-recipe tiers must record delivery; these synthetic
        // tiers stay under the 1234-byte source, so 'generated' holds.
        delivery: 'generated',
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
  const manifest = {
    assetId: 'logo-1',
    createdAt: '2026-10-01T20:00:00.000Z',
    encoder: {
      libvipsVersion: '8.18.6',
      name: 'sharp',
      sharpVersion: '0.35.4',
    },
    merchantId: MERCHANT,
    policyVersion: 1,
    recipeId: PILOT_RECIPE_ID,
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: 1234,
      format: 'png',
      orientedHeight: 48,
      orientedWidth: 48,
      sha256: SOURCE,
    },
    tiers,
    ...options.manifest,
  };
  if (!options.skipManifest) {
    await writeFile(
      join(generationDir, 'manifest.json'),
      JSON.stringify(manifest)
    );
  }
  if (options.tamper) {
    await writeFile(
      join(generationDir, options.tamper),
      Buffer.from('tampered!!')
    );
  }
  const bindings = [
    {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      originalUrl: 'https://cdn.example.com/media/logo.png',
      role: 'logo' as const,
      slotId: 'header-logo',
      sourceSha256: SOURCE,
    },
  ];
  return { bindings, generationDir, manifest, outputRoot, tiers };
}
