import { describe, expect, it } from 'vitest';
import { assertServedAgreement } from './merchant-image-pilot-preflight-agreement.mjs';
import { assertServedMountCoverage } from './merchant-image-pilot-preflight-mounts.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('preflight served mount coverage', () => {
  it('fails absent expected mounts and unlinked hero pictures', () => {
    const fixture = { generationId: 'e'.repeat(64), tiers: [] };
    const heroMount = {
      assetId: 'hero-s0',
      binding: `${MERCHANT}/hero-s0`,
      generationId: 'e'.repeat(64),
      merchantId: MERCHANT,
      role: 'hero',
      slotId: 'mobile-hero-slide-0',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-hero-s0.png`,
    };
    // No hero section at all: absent, not vacuously covered.
    const empty = `<main data-pilot-lab-arm="pilot"></main>`;
    const absent = assertServedMountCoverage(empty, {
      arm: 'pilot',
      expectedMounts: [heroMount],
      surface: 'gallery',
    });
    expect(absent.failures.join('\n')).toMatch(/absent from the served/);
    expect(absent.mounted).toEqual([]);
    // Mounted hero picture with no section link: no zero-to-zero pass.
    const unlinked = `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><picture data-pilot-lab-picture="pilot"><source media="m" sizes="s" srcSet="u" type="image/avif"/></picture></section></main>`;
    expect(
      assertServedAgreement(unlinked, { arm: 'pilot' }).join('\n')
    ).toMatch(/has no preload link/);
    void fixture;
  });

  it('binds store card coverage to the selected card, never a filler', () => {
    const origin = 'http://localhost:3129';
    const mount = {
      assetId: 'card-a',
      binding: `${MERCHANT}/card-a`,
      generationId: 'c'.repeat(64),
      merchantId: MERCHANT,
      role: 'product',
      slotId: 'product-card',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-card-a.png`,
    };
    const section = (selected, filler) =>
      `<main data-pilot-lab-arm="control"><section data-pilot-lab-slot="product-card" data-pilot-lab-binding="${mount.binding}"><div data-pilot-lab-selected-card="true">${selected}</div><article>${filler}</article></section></main>`;
    const staged = `<img src="${origin}${mount.stagedOriginal}?w=384&q=75" srcset="${origin}${mount.stagedOriginal}?w=384&q=75 384w" alt="card">`;
    const broken = `<img src="/placeholder.svg" alt="Selected product">`;
    const check = (html) =>
      assertServedMountCoverage(html, {
        arm: 'control',
        expectedMounts: [mount],
        origin,
        surface: 'store',
      });
    // Review-3 repro: broken selected card, correct filler — must fail.
    const falsePositive = check(section(broken, staged));
    expect(falsePositive.failures.join('\n')).toMatch(
      /does not serve the staged original/
    );
    expect(falsePositive.mounted).toEqual([]);
    // Correct selected card, broken filler — coverage holds (descriptors
    // own filler hygiene section-wide).
    const covered = check(section(staged, broken));
    expect(covered.failures).toEqual([]);
    expect(covered.mounted).toEqual([mount.binding]);
  });

  it('fails pilot mounts that fetch a staged original alongside the generation copy', () => {
    const origin = 'http://localhost:3129';
    const mount = {
      assetId: 'card-a',
      binding: `${MERCHANT}/card-a`,
      generationId: 'c'.repeat(64),
      merchantId: MERCHANT,
      role: 'product',
      slotId: 'product-card',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-card-a.png`,
    };
    const gen = (file) => `/__pilot/${mount.generationId}/${file}`;
    const picture = `<picture data-pilot-lab-picture="pilot" data-pilot-lab-card-image="true"><source sizes="s" srcSet="${gen('a.avif')} 48w" type="image/avif"/><source sizes="s" srcSet="${gen('w.webp')} 48w" type="image/webp"/></picture>`;
    const section = (extra) =>
      `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="product-card" data-pilot-lab-binding="${mount.binding}"><div data-pilot-lab-selected-card="true">${picture}${extra}</div></section></main>`;
    const check = (html) =>
      assertServedMountCoverage(html, {
        arm: 'pilot',
        expectedMounts: [mount],
        origin,
        surface: 'store',
      });
    // Generation copy only: intended delivery (including pass-through
    // copies), no leak.
    const clean = check(section(''));
    expect(clean.failures).toEqual([]);
    expect(clean.mounted).toEqual([mount.binding]);
    // Same generation copy plus a staged-original fetch: an accidental
    // double download, even though the mount serves this generation.
    const leaked = check(
      section(`<img src="${mount.stagedOriginal}" alt="x">`)
    );
    expect(leaked.failures.join('\n')).toMatch(
      /instead of the generation copy/
    );
    expect(leaked.mounted).toEqual([]);
  });
});
