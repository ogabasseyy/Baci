import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertServedAgreement } from './merchant-image-pilot-preflight-agreement.mjs';

const _here = dirname(fileURLToPath(import.meta.url));
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

// section subtree.
function hoistHeroLink(html) {
  const link = html.match(/<link\b[^>]*>/)?.[0];
  if (!link) {
    throw new Error('fixture has no hero preload link to hoist');
  }
  return String(html)
    .replace(link, '')
    .replace('<html>', `<html><head>${link}</head>`);
}

function _srcSetFor(asset, generationId, format) {
  return asset.tiers
    .filter((tier) => tier.format === format)
    .map((tier) => `/__pilot/${generationId}/${tier.path} ${tier.width}w`)
    .join(', ');
}

describe('preflight served agreement', () => {
  it('proves hint owners agree with the rendered picture', () => {
    const fixture = { generationId: 'e'.repeat(64), tiers: unitTiers };
    const html = labHtml({ arm: 'pilot', ...fixture });
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
    const drifted = html.replace('40vw, 152px" media', '40vw, 999px" media');
    expect(
      assertServedAgreement(drifted, { arm: 'pilot' }).length
    ).toBeGreaterThan(0);
  });

  it('requires hint and render to choose the same pass-through resource', () => {
    const passthrough = [
      { format: 'avif', path: `${'f'.repeat(64)}.avif`, width: 800 },
      { format: 'webp', path: 'w.webp', width: 384 },
    ];
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: passthrough,
    });
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
    // Stale hint: the preload still points at the previous generation's
    // file while the render serves this generation's pass-through copy.
    const staleHref = `/__pilot/${'d'.repeat(64)}/${'f'.repeat(64)}.avif`;
    const stale = html.replace(/href="[^"]*"/, `href="${staleHref}"`);
    expect(assertServedAgreement(stale, { arm: 'pilot' }).join('\n')).toMatch(
      /not one of the preloaded candidates/
    );
    // Mismatched selection: the hint carries a different candidate list
    // than the rendered pass-through source.
    const mismatch = html.replace(
      /imageSrcSet="[^"]*"/,
      'imageSrcSet="/__pilot/stale.avif 800w"'
    );
    expect(
      assertServedAgreement(mismatch, { arm: 'pilot' }).join('\n')
    ).toMatch(/imageSrcSet differs/);
  });

  it('pairs hints within their own section, never across sections', () => {
    const avif = `/__pilot/${'e'.repeat(64)}/a.avif 48w`;
    // The hero link sits in the LOGO section with attrs that would pair by
    // document order; section scoping must still fail the link-less hero.
    const html = `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="mobile-hero-slide-0" data-pilot-lab-binding="${MERCHANT}/hero-s0"><picture data-pilot-lab-picture="pilot"><source media="m" sizes="s" srcSet="${avif}" type="image/avif"/></picture></section><section data-pilot-lab-slot="header-logo" data-pilot-lab-binding="${MERCHANT}/logo-a"><link rel="preload" as="image" href="/__pilot/a" imageSrcSet="${avif}" imageSizes="s" media="m" fetchPriority="high" type="image/avif" data-pilot-lab-preload="pilot"/><picture data-pilot-lab-picture="pilot"><source sizes="40px" srcSet="${avif}" type="image/avif"/></picture></section></main>`;
    expect(assertServedAgreement(html, { arm: 'pilot' }).join('\n')).toMatch(
      /has no preload link/
    );
  });

  it('enforces the per-arm format gate on hero links', () => {
    const unitTiers = [
      { format: 'avif', path: 'a.avif', width: 48 },
      { format: 'webp', path: 'w.webp', width: 48 },
    ];
    const typed = labHtml({
      arm: 'control',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    });
    expect(assertServedAgreement(typed, { arm: 'control' }).join('\n')).toMatch(
      /wrong format gate/
    );
    const untyped = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    }).replace(
      'fetchPriority="high" type="image/avif" data-pilot-lab-preload',
      'fetchPriority="high" data-pilot-lab-preload'
    );
    expect(assertServedAgreement(untyped, { arm: 'pilot' }).join('\n')).toMatch(
      /wrong format gate/
    );
  });

  it('pairs a head-hoisted hero preload with its section picture', () => {
    const html = hoistHeroLink(
      labHtml({ arm: 'pilot', generationId: 'e'.repeat(64), tiers: unitTiers })
    );
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
  });

  it('still fails a hoisted link whose srcset drifts from the picture', () => {
    const html = hoistHeroLink(
      labHtml({ arm: 'pilot', generationId: 'e'.repeat(64), tiers: unitTiers })
    );
    const drifted = html.replace('a.avif 48w', 'a.avif 999w');
    expect(
      assertServedAgreement(drifted, { arm: 'pilot' }).length
    ).toBeGreaterThan(0);
  });

  it('catches a hero picture mis-mounted outside the hero slot', () => {
    // A hero-kind picture under a foreign slot must pair, not slip past
    // the slot filter: pairing is by binding identity, not slot name.
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    }).replaceAll(
      'data-pilot-lab-slot="mobile-hero-slide-0"',
      'data-pilot-lab-slot="header-logo"'
    );
    expect(assertServedAgreement(html, { arm: 'pilot' })).toEqual([]);
    const unlinked = html.replace(/<link\b[^>]*>/, '');
    expect(
      assertServedAgreement(unlinked, { arm: 'pilot' }).join('\n')
    ).toMatch(/has no preload link/);
  });

  it('still fails a mounted hero with no preload link anywhere', () => {
    const html = labHtml({
      arm: 'pilot',
      generationId: 'e'.repeat(64),
      tiers: unitTiers,
    });
    const unlinked = html.replace(/<link\b[^>]*>/, '');
    expect(
      assertServedAgreement(unlinked, { arm: 'pilot' }).join('\n')
    ).toMatch(/has no preload link/);
  });
});
