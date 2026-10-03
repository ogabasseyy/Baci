import { describe, expect, it } from 'vitest';
import {
  extractLabPictures,
  extractLabPreloads,
  extractLabSections,
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
});
