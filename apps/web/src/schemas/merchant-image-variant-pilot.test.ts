import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  matchPilotAcceptance,
  PILOT_POLICY_VERSION,
  PILOT_RECIPE_ID,
  PILOT_SCHEMA_VERSION,
  parsePilotAcceptance,
  parsePilotInventoryBinding,
  parsePilotManifest,
} from './merchant-image-variant-pilot';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures',
  'contract-fixtures.json'
);

async function loadFixtures() {
  return JSON.parse(await readFile(FIXTURES_PATH, 'utf8'));
}

describe('pilot contract identity', () => {
  it('pins the same schema, policy, and recipe identity as the generator', async () => {
    const fixtures = await loadFixtures();
    expect(PILOT_SCHEMA_VERSION).toBe(fixtures.pinned.schemaVersion);
    expect(PILOT_POLICY_VERSION).toBe(fixtures.pinned.policyVersion);
    expect(PILOT_RECIPE_ID).toBe(fixtures.pinned.recipeId);
  });
});

describe('parsePilotManifest', () => {
  it('accepts the shared valid manifest', async () => {
    const fixtures = await loadFixtures();
    expect(parsePilotManifest(fixtures.validManifest).ok).toBe(true);
    expect(parsePilotManifest(fixtures.validManifestOffset).ok).toBe(true);
  });

  it('accepts the guarded r2 manifest and keeps legacy r1 tiers valid', async () => {
    const fixtures = await loadFixtures();
    expect(parsePilotManifest(fixtures.validManifestGuarded).ok).toBe(true);
    for (const tier of fixtures.validManifest.tiers) {
      expect(tier.delivery).toBeUndefined();
    }
  });

  it('rejects every shared invalid manifest', async () => {
    const fixtures = await loadFixtures();
    for (const [label, candidate] of Object.entries(
      fixtures.invalidManifests as Record<string, unknown>
    )) {
      expect(parsePilotManifest(candidate).ok, label).toBe(false);
    }
  });
});

describe('parsePilotAcceptance and matchPilotAcceptance', () => {
  it('accepts the shared valid pair', async () => {
    const fixtures = await loadFixtures();
    expect(parsePilotAcceptance(fixtures.validAcceptance).ok).toBe(true);
    expect(parsePilotAcceptance(fixtures.validAcceptanceOffset).ok).toBe(true);
    expect(
      matchPilotAcceptance({
        acceptance: fixtures.validAcceptance,
        binding: {
          originalUrl: fixtures.validAcceptance.originalUrl,
        } as never,
        manifest: fixtures.validManifest,
      })
    ).toEqual({ ok: true });
  });

  it('binds capped rungs positionally, not as a set', async () => {
    const fixtures = await loadFixtures();
    const shared = fixtures.validManifest.tiers[0].sha256;
    const deduped = {
      ...fixtures.validManifest,
      tiers: fixtures.validManifest.tiers.map((tier: { sha256: string }) => ({
        ...tier,
        sha256: shared,
      })),
    };
    // One hash per tier position: each rung stays bound even when capped
    // rungs share bytes.
    const record = {
      ...fixtures.validAcceptance,
      outputHashes: fixtures.validManifest.tiers.map(() => shared),
    };
    const binding = {
      originalUrl: fixtures.validAcceptance.originalUrl,
    } as never;
    expect(
      matchPilotAcceptance({ acceptance: record, binding, manifest: deduped })
    ).toEqual({
      ok: true,
    });
    const short = { ...fixtures.validAcceptance, outputHashes: [shared] };
    expect(
      matchPilotAcceptance({ acceptance: short, binding, manifest: deduped }).ok
    ).toBe(false);
  });

  it('rejects swapped tier hashes with an unchanged set', async () => {
    const fixtures = await loadFixtures();
    const tiers = fixtures.validManifest.tiers;
    const swapped = {
      ...fixtures.validManifest,
      tiers: tiers.map((tier: { sha256: string }, index: number) => ({
        ...tier,
        sha256: tiers[(index + 2) % tiers.length].sha256,
      })),
    };
    expect(
      matchPilotAcceptance({
        acceptance: fixtures.validAcceptance,
        binding: {
          originalUrl: fixtures.validAcceptance.originalUrl,
        } as never,
        manifest: swapped,
      })
    ).toEqual({ ok: false, reason: 'encoded output bytes changed' });
  });

  it('rejects a quality change with identical hashes and bytes', async () => {
    const fixtures = await loadFixtures();
    const tiers = fixtures.validManifest.tiers;
    const regraded = {
      ...fixtures.validManifest,
      tiers: tiers.map((tier: { quality: number }, index: number) => ({
        ...tier,
        quality: index === 0 ? 65 : tier.quality,
      })),
    };
    expect(
      matchPilotAcceptance({
        acceptance: fixtures.validAcceptance,
        binding: {
          originalUrl: fixtures.validAcceptance.originalUrl,
        } as never,
        manifest: regraded,
      })
    ).toEqual({ ok: false, reason: 'tier quality changed' });
  });

  it('rejects a retargeted original URL with everything else unchanged', async () => {
    const fixtures = await loadFixtures();
    expect(
      matchPilotAcceptance({
        acceptance: fixtures.matcherRejections.changedUrl,
        binding: {
          originalUrl: fixtures.validAcceptance.originalUrl,
        } as never,
        manifest: fixtures.validManifest,
      })
    ).toEqual({ ok: false, reason: 'original URL changed' });
  });

  it('rejects every shared invalid acceptance schema', async () => {
    const fixtures = await loadFixtures();
    for (const [label, candidate] of Object.entries(
      fixtures.invalidAcceptanceSchemas as Record<string, unknown>
    )) {
      expect(parsePilotAcceptance(candidate).ok, label).toBe(false);
    }
  });

  it('rejects every shared matcher drift', async () => {
    const fixtures = await loadFixtures();
    for (const [label, candidate] of Object.entries(
      fixtures.matcherRejections as Record<string, unknown>
    )) {
      const result = matchPilotAcceptance({
        acceptance: candidate as never,
        binding: {
          originalUrl: fixtures.validAcceptance.originalUrl,
        } as never,
        manifest: fixtures.validManifest,
      });
      expect(result.ok, label).toBe(false);
    }
  });
});

describe('parsePilotInventoryBinding', () => {
  const binding = {
    assetId: 'logo-1',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    originalUrl: 'https://cdn.example.com/media/logo.png',
    role: 'logo',
    slotId: 'header-logo',
    sourceSha256:
      'd9ffc58df5cc06104ae0eb604f84606549e8e6b5d06a35bff668c1f2e3511b98',
  };

  it('accepts a complete slot binding', () => {
    expect(parsePilotInventoryBinding(binding).ok).toBe(true);
  });

  it('rejects malformed bindings strictly', () => {
    expect(parsePilotInventoryBinding({ ...binding, extra: true }).ok).toBe(
      false
    );
    expect(
      parsePilotInventoryBinding({ ...binding, merchantId: 'nope' }).ok
    ).toBe(false);
    expect(
      parsePilotInventoryBinding({ ...binding, originalUrl: 'ftp://x/y.png' })
        .ok
    ).toBe(false);
    expect(
      parsePilotInventoryBinding({ ...binding, originalUrl: '/relative.png' })
        .ok
    ).toBe(false);
    expect(parsePilotInventoryBinding({ ...binding, role: 'banner' }).ok).toBe(
      false
    );
    expect(
      parsePilotInventoryBinding({ ...binding, sourceSha256: 'short' }).ok
    ).toBe(false);
    expect(parsePilotInventoryBinding({ ...binding, slotId: '' }).ok).toBe(
      false
    );
  });
});
