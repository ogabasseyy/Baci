import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertOgabasseyLayoutFeasibility } from './assert-ogabassey-layout-feasibility';
import {
  HERO_HINT,
  SENTINEL,
  writeFixture,
} from './assert-ogabassey-layout-feasibility.test-support';

describe('assertOgabasseyLayoutFeasibility', () => {
  it('rejects missing CSS sentinel even if a script contains the marker', async () => {
    const fixture = await writeFixture();
    await writeFile(
      path.join(fixture.captureDir, 'assets/oga-critical.css'),
      ''
    );
    await writeFile(
      path.join(fixture.prebuiltDir, '_next/static/css/oga-critical.css'),
      ''
    );
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(/critical stylesheet.*sentinel/i);
  });
  it('proves both generated homes own a static marker and isolated critical CSS', async () => {
    const fixture = await writeFixture();

    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).resolves.toMatchObject({
      criticalDependencyFiles: [
        '/_next/static/chunks/oga-critical.js',
        '/_next/static/css/oga-critical.css',
      ],
      generatedIdentifiers: ['ogabassey.com', 'ogabassey'],
      passed: true,
    });
  });

  it('rejects repeated identifiers rather than testing the same alias twice', async () => {
    const fixture = await writeFixture();
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/distinct.*identifiers/i);
  });

  it('rejects identifiers containing a path traversal', async () => {
    const fixture = await writeFixture();
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['../outside', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/invalid.*identifier/i);
  });

  it('rejects a generic merchant identifier that overlaps the homes', async () => {
    const fixture = await writeFixture();
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        heroHint: HERO_HINT,
        genericIdentifier: 'ogabassey',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
      })
    ).rejects.toThrow(/overlap.*identifier/i);
  });

  it('rejects a marker that lands after the first postponed boundary', async () => {
    const fixture = await writeFixture({ markerAfterBoundary: true });

    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(/marker.*before.*postponed boundary/i);
  });

  it('rejects missing generated identifiers and negative-route marker leakage', async () => {
    const missing = await writeFixture({ missingGeneratedIdentifier: true });
    const leakage = await writeFixture({ negativeMarker: true });

    await expect(
      assertOgabasseyLayoutFeasibility({
        ...missing,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(/ogabassey\.com.*not prerendered/i);
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...leakage,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(/category.*marker/i);
  });

  it.each([
    'missingHeroHint',
    'heroHintAfterBoundary',
  ] as const)('rejects %s', async (key) => {
    const fixture = await writeFixture({ [key]: true });
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(/hero.*preload/i);
  });

  it.each([
    'category',
    'pdp',
    'blog',
  ] as const)('rejects missing %s capture', async (kind) => {
    const fixture = await writeFixture({ missingKind: kind });
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(new RegExp(`${kind}.*missing`, 'i'));
  });

  it.each([
    'category',
    'pdp',
    'blog',
  ] as const)('rejects %s critical dependency leakage', async (kind) => {
    const fixture = await writeFixture({ leakingKind: kind });
    await expect(
      assertOgabasseyLayoutFeasibility({
        ...fixture,
        cssSentinel: SENTINEL,
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        marker: 'data-ogabassey-critical-spike=v1',
        heroHint: HERO_HINT,
      })
    ).rejects.toThrow(new RegExp(`${kind}.*critical dependency`, 'i'));
  });
});
