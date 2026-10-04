import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { PILOT_RECIPE_ID } from '@/schemas/merchant-image-variant-pilot';
import { buildLabIndex, lookupPilotTiers, selectPilotTier } from './lab-index';

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

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const SOURCE =
  'd9ffc58df5cc06104ae0eb604f84606549e8e6b5d06a35bff668c1f2e3511b98';
const GENERATION_ID = 'c'.repeat(64);

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function setupLab(
  options: {
    manifest?: Record<string, unknown>;
    acceptance?: Record<string, unknown>;
    tamper?: string;
    skipManifest?: boolean;
  } = {}
) {
  const base = join(
    tmpdir(),
    `pilot-lab-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const outputRoot = join(base, 'output');
  const generationDir = join(outputRoot, 'generations', GENERATION_ID);
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

describe('buildLabIndex', () => {
  let lab: Awaited<ReturnType<typeof setupLab>>;

  beforeEach(async () => {
    lab = await setupLab();
  });

  it('accepts a verified manifest, acceptance, and output hashes', async () => {
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toBe('accepted');
    expect(Object.isFrozen(index)).toBe(true);
    const tiers = lookupPilotTiers(index, {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      role: 'logo',
      sourceSha256: SOURCE,
    });
    expect(tiers).toHaveLength(6);
  });

  it('rejects an oversized otherwise valid manifest before activating its tiers', async () => {
    await writeFile(
      join(lab.generationDir, 'manifest.json'),
      `${JSON.stringify(lab.manifest)}${' '.repeat(256 * 1024)}`
    );
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Reviewed',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(statuses[0]?.status).not.toBe('accepted');
    expect(Object.keys(index.entries)).toHaveLength(0);
  });

  it('surfaces guarded dispositions explicitly', async () => {
    const guardedTiers = lab.tiers.map((tier) => ({
      ...tier,
      delivery: 'generated',
    }));
    const guarded = await setupLab({
      manifest: { tiers: guardedTiers },
    });
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: guardedTiers.map((tier) => tier.sha256),
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: guarded.bindings,
      outputRoot: guarded.outputRoot,
    });
    expect(statuses[0]?.status).toBe('accepted');
    const tiers = lookupPilotTiers(index, {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      role: 'logo',
      sourceSha256: SOURCE,
    });
    expect(tiers?.map((tier) => tier.delivery)).toEqual(
      Array(6).fill('generated')
    );
  });

  it('rejects a current-recipe manifest that omits delivery', async () => {
    // Delivery-less tiers are frozen r1 legacy only. Under the current
    // recipe the omission would skip every never-larger check, so the
    // lab refuses to activate instead of mapping to 'legacy'.
    const undelivered = lab.tiers.map((tier) => {
      const { delivery: _delivery, ...rest } = tier;
      void _delivery;
      return rest;
    });
    const fixture = await setupLab({ manifest: { tiers: undelivered } });
    const { index, statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: undelivered.map((tier) => tier.sha256),
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: fixture.bindings,
      outputRoot: fixture.outputRoot,
    });
    expect(statuses[0]?.status).toBe('invalid-manifest');
    expect(
      lookupPilotTiers(index, {
        assetId: 'logo-1',
        merchantId: MERCHANT,
        role: 'logo',
        sourceSha256: SOURCE,
      })
    ).toBeNull();
  });

  it('rejects a guarded manifest whose disposition violates the source bytes', async () => {
    const violating = lab.tiers.map((tier, position) =>
      position === 0 ? { ...tier, bytes: 1235, delivery: 'generated' } : tier
    );
    const fixture = await setupLab({ manifest: { tiers: violating } });
    const { statuses } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'Lab review: legible, colors preserved.',
          outputHashes: violating.map((tier) => tier.sha256),
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: fixture.bindings,
      outputRoot: fixture.outputRoot,
    });
    expect(statuses[0]?.status).toBe('invalid-manifest');
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
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
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
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
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
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    const rejected = await buildLabIndex({
      acceptances: [{ ...base, verdict: 'rejected' as const }],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(rejected.statuses[0]?.status).toBe('rejected');

    const stale = await setupLab({
      acceptance: { recipeId: 'pilot-r1-old' },
      manifest: { recipeId: 'pilot-r1-old' },
    });
    const staleResult = await buildLabIndex({
      acceptances: [
        {
          ...base,
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
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
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

  it('refuses to activate conflicting duplicate acceptances in either order', async () => {
    const accepted = {
      assetId: 'logo-1',
      generationId: GENERATION_ID,
      merchantId: MERCHANT,
      note: 'n',
      outputHashes: lab.tiers.map((tier) => tier.sha256),
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    const rejected = { ...accepted, verdict: 'rejected' as const };
    for (const acceptances of [
      [accepted, rejected],
      [rejected, accepted],
    ]) {
      const result = await buildLabIndex({
        acceptances,
        bindings: lab.bindings,
        outputRoot: lab.outputRoot,
      });
      expect(result.statuses[0]?.status).toBe('acceptance-mismatch');
      expect(result.statuses[0]?.detail).toMatch(/conflicting duplicate/);
      expect(
        lookupPilotTiers(result.index, {
          assetId: 'logo-1',
          merchantId: MERCHANT,
          role: 'logo',
          sourceSha256: SOURCE,
        })
      ).toBeNull();
      expect(
        result.diagnostics.some((entry) => /duplicate acceptances/.test(entry))
      ).toBe(true);
    }
  });

  it('treats exact duplicate acceptances as idempotent', async () => {
    const acceptance = {
      assetId: 'logo-1',
      generationId: GENERATION_ID,
      merchantId: MERCHANT,
      note: 'n',
      outputHashes: lab.tiers.map((tier) => tier.sha256),
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    const result = await buildLabIndex({
      acceptances: [acceptance, { ...acceptance }],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('accepted');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('treats swapped-hash duplicates as conflicting, not idempotent', async () => {
    const hashes = lab.tiers.map((tier) => tier.sha256);
    const base = {
      assetId: 'logo-1',
      generationId: GENERATION_ID,
      merchantId: MERCHANT,
      note: 'n',
      recipeId: PILOT_RECIPE_ID,
      reviewedAt: '2026-10-01T21:00:00.000Z',
      reviewer: 'pilot-owner',
      schemaVersion: 1,
      sourceSha256: SOURCE,
      verdict: 'accepted' as const,
    };
    // Same multiset, swapped positions: binding pins each hash to one
    // rung positionally, so these are conflicting verdicts. An
    // order-insensitive dedupe would silently drop the second.
    const result = await buildLabIndex({
      acceptances: [
        { ...base, outputHashes: hashes },
        { ...base, outputHashes: [...hashes].reverse() },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('acceptance-mismatch');
    expect(result.statuses[0]?.detail).toMatch(/conflicting duplicate/);
    expect(
      result.diagnostics.some((entry) => /duplicate acceptances/.test(entry))
    ).toBe(true);
  });

  it('keeps malformed acceptances diagnosable instead of dropping them silently', async () => {
    const result = await buildLabIndex({
      acceptances: [{ assetId: 'logo-1', verdict: 'accepted' }],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    expect(result.statuses[0]?.status).toBe('missing-acceptance');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatch(/acceptance\[0\] invalid/);
  });
});

describe('lookupPilotTiers and selectPilotTier', () => {
  it('binds lookups to the full identity and selects adequate tiers', async () => {
    const lab = await setupLab();
    const { index } = await buildLabIndex({
      acceptances: [
        {
          assetId: 'logo-1',
          generationId: GENERATION_ID,
          merchantId: MERCHANT,
          note: 'n',
          outputHashes: lab.tiers.map((tier) => tier.sha256),
          recipeId: PILOT_RECIPE_ID,
          reviewedAt: '2026-10-01T21:00:00.000Z',
          reviewer: 'pilot-owner',
          schemaVersion: 1,
          sourceSha256: SOURCE,
          verdict: 'accepted',
        },
      ],
      bindings: lab.bindings,
      outputRoot: lab.outputRoot,
    });
    // A rotated source hash no longer resolves.
    expect(
      lookupPilotTiers(index, {
        assetId: 'logo-1',
        merchantId: MERCHANT,
        role: 'logo',
        sourceSha256: 'f'.repeat(64),
      })
    ).toBeNull();
    const tiers = lookupPilotTiers(index, {
      assetId: 'logo-1',
      merchantId: MERCHANT,
      role: 'logo',
      sourceSha256: SOURCE,
    });
    expect(tiers).not.toBeNull();
    // Lookup is synchronous and I/O-free.
    expect(tiers instanceof Promise).toBe(false);
    const webp = selectPilotTier(tiers ?? [], {
      format: 'webp',
      requestedWidth: 40,
    });
    expect(webp?.width).toBe(48);
    // Beyond the ladder is out of coverage, not a silent upscale.
    expect(
      selectPilotTier(tiers ?? [], { format: 'webp', requestedWidth: 49 })
    ).toBeNull();
    expect(
      selectPilotTier(tiers ?? [], { format: 'avif', requestedWidth: 48 })
        ?.format
    ).toBe('avif');
  });
});
