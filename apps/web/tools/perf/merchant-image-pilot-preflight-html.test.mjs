import { describe, expect, it } from 'vitest';
import {
  extractLabPictures,
  extractLabPreloads,
  extractLabSections,
  srcSetCandidates,
  srcSetEveryHasPrefix,
} from './merchant-image-pilot-preflight-html.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function labHtml({ arm, generationId, tiers }) {
  const srcSetFor = (format) =>
    tiers
      .filter((tier) => tier.format === format)
      .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
      .join(', ');
  const avif = srcSetFor('avif');
  const webp = srcSetFor('webp');
  const smallestTier = tiers.find((tier) => tier.format === 'avif');
  const smallest = smallestTier
    ? `/__pilot/${generationId}/${smallestTier.path}`
    : `/__pilot/${generationId}/placeholder.avif`;
  return `<!doctype html><html><body><main data-pilot-lab-arm="${arm}">
<section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><link rel="preload" as="image" href="${smallest}" imageSrcSet="${avif}" imageSizes="(max-width: 768px) 40vw, 152px" media="(max-width: 768px)" fetchPriority="high" type="image/avif" data-pilot-lab-preload="${arm}" data-pilot-lab-binding="${MERCHANT}/hero-s0"/><picture data-pilot-lab-picture="${arm}"><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${avif}" type="image/avif"/><source media="(max-width: 768px)" sizes="(max-width: 768px) 40vw, 152px" srcSet="${webp}"/></picture></section>
<section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><picture data-pilot-lab-picture="${arm}"><source sizes="40px" srcSet="${avif}" type="image/avif"/><source sizes="40px" srcSet="${webp}" type="image/webp"/></picture></section>
</main></body></html>`;
}

const unitTiers = [
  { format: 'avif', path: 'a.avif', width: 48 },
  { format: 'webp', path: 'w.webp', width: 48 },
];

function notOptimizedSection(binding, slotId) {
  return `<section data-pilot-lab-slot="${slotId}" data-pilot-lab-binding="${binding}" data-pilot-lab-status="not-optimized"><h2>${slotId} — not optimized</h2><p>fixture row</p></section>`;
}

function _srcSetFor(asset, generationId, format) {
  return asset.tiers
    .filter((tier) => tier.format === format)
    .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
    .join(', ');
}

describe('preflight served HTML extraction', () => {
  it('extracts lab preloads and pictures from served HTML', () => {
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    });
    expect(extractLabPreloads(html)).toHaveLength(1);
    expect(extractLabPictures(html)).toHaveLength(2);
  });

  it('extracts binding sections with their reporting status', () => {
    const html = `<section data-pilot-lab-binding="m/a" data-pilot-lab-slot="header-logo"><picture></picture></section>${notOptimizedSection('m/b', 'product-card')}<section data-pilot-lab-slot="product-card" data-pilot-lab-status="missing-binding"><h2>x</h2></section><section><p>unrelated</p></section>`;
    const sections = extractLabSections(html);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({
      binding: 'm/a',
      slotId: 'header-logo',
      status: null,
    });
    expect(sections[1]).toMatchObject({
      binding: 'm/b',
      status: 'not-optimized',
    });
    expect(sections[2]).toMatchObject({
      binding: null,
      status: 'missing-binding',
    });
  });

  it('requires every srcset candidate to carry the generation prefix', () => {
    const gen = 'e'.repeat(64);
    const pure = `/__pilot/${gen}/a.avif 384w, /__pilot/${gen}/b.avif 768w`;
    const mixed = `${pure}, /__pilot/${'f'.repeat(64)}/evil.avif 1280w`;
    expect(srcSetEveryHasPrefix(pure, `/__pilot/${gen}/`, '')).toBe(true);
    expect(srcSetEveryHasPrefix(mixed, `/__pilot/${gen}/`, '')).toBe(false);
    expect(srcSetEveryHasPrefix('', `/__pilot/${gen}/`, '')).toBe(false);
    // Query params (loader ?w&q) strip before comparison.
    expect(
      srcSetEveryHasPrefix(
        `/__pilot/${gen}/a.avif?w=384&q=75 384w`,
        `/__pilot/${gen}/`,
        ''
      )
    ).toBe(true);
  });
});

describe('srcSetCandidates', () => {
  it('splits width-described candidates', () => {
    expect(srcSetCandidates('/a.avif 384w, /b.avif 768w')).toEqual([
      { descriptor: 384, kind: 'w', url: '/a.avif' },
      { descriptor: 768, kind: 'w', url: '/b.avif' },
    ]);
  });

  it('splits density-described candidates individually', () => {
    // A control next/image mount emits the normal `1x, 2x` density
    // srcset: collapsing it to one URL would validate only the first
    // candidate while a DPR-2 browser selects the second.
    expect(srcSetCandidates('/a.png 1x, /b.png 2x')).toEqual([
      { descriptor: 1, kind: 'x', url: '/a.png' },
      { descriptor: 2, kind: 'x', url: '/b.png' },
    ]);
    expect(srcSetCandidates('/a.png 1.5x')).toEqual([
      { descriptor: 1.5, kind: 'x', url: '/a.png' },
    ]);
  });

  it('keeps bare and data URLs as a single undescribed candidate', () => {
    expect(srcSetCandidates('/a.avif')).toEqual([
      { descriptor: null, kind: null, url: '/a.avif' },
    ]);
    expect(srcSetCandidates('')).toEqual([]);
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    expect(srcSetCandidates(pixel)).toEqual([
      { descriptor: null, kind: null, url: pixel },
    ]);
  });
});
