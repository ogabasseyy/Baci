import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { PILOT_MAX_MANIFEST_BYTES } from '@/schemas/merchant-image-variant-pilot-constants';
import { labGenerationIdFor } from './lab-generation-identity';
import { buildLabIndex, lookupPilotTiers } from './lab-index';
import {
  GENERATION_ID,
  MERCHANT,
  SOURCE,
  setupLab,
} from './lab-index-fixtures';

describe('buildLabIndex activation', () => {
  let lab: Awaited<ReturnType<typeof setupLab>>;

  beforeEach(async () => {
    lab = await setupLab();
  });

  it('freezes the entries dict against replacement, deletion, and insertion', async () => {
    const { index } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          qualities: lab.tiers.map((tier) => tier.quality),
          originalUrl: 'https://cdn.example.com/media/logo.png',
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          slotId: 'header-logo',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    const key = `${MERCHANT}/logo-1/${SOURCE}/logo`;
    expect(Object.isFrozen(index.entries)).toBe(true);
    const entries = index.entries as Record<string, unknown>;
    expect(() => {
      entries[key] = [];
    }).toThrow(TypeError);
    expect(() => {
      delete entries[key];
    }).toThrow(TypeError);
    expect(() => {
      entries['attacker/evil/deadbeef/logo'] = [];
    }).toThrow(TypeError);
    expect(
      lookupPilotTiers(index, {
        assetId: 'logo-1',
        merchantId: MERCHANT,
        role: 'logo',
        sourceSha256: SOURCE,
      })
    ).toHaveLength(6);
  });

  it('reports missing manifests and invalid bytes as not optimized', async () => {
    const missing = await buildLabIndex({
      acceptances: [],
      bindings: lab.bindings,
      outputRoot: join(tmpdir(), `pilot-empty-${Date.now()}`),
    });
    expect(missing.statuses[0]?.status).toBe('missing-acceptance');

    const tampered = await setupLab({ tamper: lab.tiers[0]?.path });
    const tamperedResult = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'n',
          outputHashes: tampered.tiers.map((tier) => tier.sha256),
          qualities: tampered.tiers.map((tier) => tier.quality),
          originalUrl: 'https://cdn.example.com/media/logo.png',
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          slotId: 'header-logo',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: tampered.bindings,
      outputRoot: tampered.outputRoot,
    });
    expect(tamperedResult.statuses[0]?.status).toBe('hash-mismatch');
  });

  it('rejects rejected verdicts, stale recipes, and binding drift', async () => {
    const base = {
      assetId: 'logo-1',
      generationId: GENERATION_ID,
      merchantId: MERCHANT,
      note: 'n',
      outputHashes: lab.tiers.map((tier) => tier.sha256),
      qualities: lab.tiers.map((tier) => tier.quality),
      originalUrl: 'https://cdn.example.com/media/logo.png',
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      slotId: 'header-logo',
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    const rejected = await buildLabIndex({
      acceptances: [{ ...base, verdict: 'rejected' as const }],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(rejected.statuses[0]?.status).toBe('rejected');

    // A realistic stale generation: produced (and id-bound) under the
    // old recipe, so the binding check passes and the recipe gate fires.
    const staleId = labGenerationIdFor({
      assetId: 'logo-1',
      encoderIdentity: {
        libvipsVersion: '8.18.6',
        name: 'sharp',
        sharpVersion: '0.35.4',
      },
      merchantId: MERCHANT,
      recipeId: 'pilot-r1-old',
      role: 'logo',
      sourceSha256: SOURCE,
    });
    const stale = await setupLab({
      acceptance: { recipeId: 'pilot-r1-old' },
      generationId: staleId,
      manifest: { recipeId: 'pilot-r1-old' },
    });
    const staleResult = await buildLabIndex({
      acceptances: [
        {
          ...base,
          generationId: staleId,
          outputHashes: stale.tiers.map((t) => t.sha256),
          recipeId: 'pilot-r1-old',
        },
      ],
      bindings: stale.bindings,
      outputRoot: stale.outputRoot,
    });
    expect(staleResult.statuses[0]?.status).toBe('stale-recipe');

    const foreign = await setupLab({
      manifest: { merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20' },
    });
    const foreignResult = await buildLabIndex({
      acceptances: [base],
      bindings: foreign.bindings,
      outputRoot: foreign.outputRoot,
    });
    expect(foreignResult.statuses[0]?.status).toBe('binding-mismatch');
  });

  it('reports a missing manifest when the acceptance has no generation on disk', async () => {
    const lab = await setupLab({ skipManifest: true });
    const result = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'n',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          qualities: lab.tiers.map((tier) => tier.quality),
          originalUrl: 'https://cdn.example.com/media/logo.png',
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          slotId: 'header-logo',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('missing-manifest');
    expect(result.statuses[0]?.generationId).toBe(GENERATION_ID);
  });

  it('rejects an otherwise-valid manifest padded past the 64 KiB ceiling', async () => {
    // Ceiling pin for PILOT_MAX_MANIFEST_BYTES: trailing JSON
    // whitespace keeps the manifest schema-valid, but the runtime
    // loader must reject exactly what the generator and offline
    // preflight reject (MAX_MANIFEST_BYTES) instead of activating a
    // generation the evidence gate refuses.
    const lab = await setupLab();
    const manifestPath = join(lab.generationDir, 'manifest.json');
    const text = await readFile(manifestPath, 'utf8');
    await writeFile(
      manifestPath,
      text + ' '.repeat(PILOT_MAX_MANIFEST_BYTES - text.length + 1)
    );
    const result = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'n',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          qualities: lab.tiers.map((tier) => tier.quality),
          originalUrl: 'https://cdn.example.com/media/logo.png',
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          slotId: 'header-logo',
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('missing-manifest');
    expect(Object.keys(result.index.entries)).toHaveLength(0);
  });
});
