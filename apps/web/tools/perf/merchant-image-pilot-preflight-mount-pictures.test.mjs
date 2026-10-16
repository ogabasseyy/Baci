import { describe, expect, it } from 'vitest';
import { assertServedMountCoverage } from './merchant-image-pilot-preflight-mounts.mjs';

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('assertServedMountCoverage picture audits', () => {
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

  it('audits every mounted hero picture, never just the first', () => {
    const origin = 'http://localhost:3129';
    const mount = {
      assetId: 'hero-s0',
      binding: `${MERCHANT}/hero-s0`,
      generationId: 'e'.repeat(64),
      merchantId: MERCHANT,
      role: 'hero',
      slotId: 'mobile-hero-slide-0',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-hero-s0.png`,
    };
    const gen = (file) => `/__pilot/${mount.generationId}/${file}`;
    const heroPicture = (avif, fallback, extra = '') =>
      `<picture data-pilot-lab-picture="pilot"><source media="(max-width: 767px)" sizes="s" srcSet="${avif} 48w" type="image/avif"/><source media="(max-width: 767px)" sizes="s" srcSet="${fallback} 48w"/>${extra}</picture>`;
    const page = (arm, pictures) =>
      `<main data-pilot-lab-arm="${arm}"><section data-pilot-lab-slot="${mount.slotId}" data-pilot-lab-binding="${mount.binding}">${pictures}</section></main>`;
    const check = (html, arm) =>
      assertServedMountCoverage(html, {
        arm,
        expectedMounts: [mount],
        origin,
        surface: 'gallery',
      });
    const clean = heroPicture(gen('a.avif'), gen('w.webp'));
    // A second hero picture serving foreign bytes must not pass behind
    // a clean first picture.
    const foreignSecond = check(
      page('pilot', clean + heroPicture('/foreign/x.avif', gen('w.webp'))),
      'pilot'
    );
    expect(foreignSecond.failures.join('\n')).toMatch(
      /serves bytes outside this generation/
    );
    expect(foreignSecond.mounted).toEqual([]);
    // Control arm likewise: every picture must serve the staged original.
    const controlPicture = (imgSrc) =>
      `<picture data-pilot-lab-picture="control"><img src="${imgSrc}" alt="lab"></picture>`;
    const controlForeign = check(
      page(
        'control',
        controlPicture(mount.stagedOriginal) +
          controlPicture('/placeholder.svg')
      ),
      'control'
    );
    expect(controlForeign.failures.join('\n')).toMatch(
      /does not serve the staged original/
    );
    expect(controlForeign.mounted).toEqual([]);
    // Two clean pictures pass: auditing all must not false-positive.
    const cleanPair = check(page('pilot', clean + clean), 'pilot');
    expect(cleanPair.failures).toEqual([]);
    expect(cleanPair.mounted).toEqual([mount.binding]);
  });

  it('audits the pilot fallback img, not just the typed sources', () => {
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
    const cardPicture = (img) =>
      `<picture data-pilot-lab-picture="pilot"><source sizes="s" srcSet="${gen('a.avif')} 48w" type="image/avif"/><source sizes="s" srcSet="${gen('w.webp')} 48w" type="image/webp"/>${img}</picture>`;
    const page = (picture) =>
      `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="${mount.slotId}" data-pilot-lab-binding="${mount.binding}">${picture}</section></main>`;
    const check = (html) =>
      assertServedMountCoverage(html, {
        arm: 'pilot',
        expectedMounts: [mount],
        origin,
        surface: 'gallery',
      });
    // Clean sources but a foreign fallback img: the img serves bytes too.
    const foreignImg = check(
      page(cardPicture(`<img src="/foreign/fallback.png" alt="card">`))
    );
    expect(foreignImg.failures.join('\n')).toMatch(/fallback img/);
    expect(foreignImg.mounted).toEqual([]);
    // An img with neither src nor srcset renders nothing: broken, not clean.
    const srcless = check(page(cardPicture(`<img alt="card">`)));
    expect(srcless.failures.join('\n')).toMatch(/fallback img/);
    expect(srcless.mounted).toEqual([]);
    // The mobile hero's transparent pixel is inline bytes, not a fetch.
    const pixel = check(
      page(
        cardPicture(
          `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="card">`
        )
      )
    );
    expect(pixel.failures).toEqual([]);
    expect(pixel.mounted).toEqual([mount.binding]);
    // A generation-scoped fallback img passes.
    const clean = check(
      page(cardPicture(`<img src="${gen('w.webp')}" alt="card">`))
    );
    expect(clean.failures).toEqual([]);
    expect(clean.mounted).toEqual([mount.binding]);
  });

  it('audits every mounted logo picture, never just the first', () => {
    const origin = 'http://localhost:3129';
    const mount = {
      assetId: 'logo-1',
      binding: `${MERCHANT}/logo-1`,
      generationId: 'd'.repeat(64),
      merchantId: MERCHANT,
      role: 'logo',
      slotId: 'header-logo',
      stagedOriginal: `/__pilot/originals/${MERCHANT}-logo-1.png`,
    };
    const gen = (file) => `/__pilot/${mount.generationId}/${file}`;
    const logoPicture = (avif) =>
      `<picture data-pilot-lab-header-logo="true"><source sizes="s" srcSet="${avif} 48w" type="image/avif"/><source sizes="s" srcSet="${gen('w.webp')} 48w" type="image/webp"/></picture>`;
    const page = (pictures) =>
      `<main data-pilot-lab-arm="pilot"><section data-pilot-lab-slot="${mount.slotId}" data-pilot-lab-binding="${mount.binding}">${pictures}</section></main>`;
    const check = (html) =>
      assertServedMountCoverage(html, {
        arm: 'pilot',
        expectedMounts: [mount],
        origin,
        surface: 'gallery',
      });
    const clean = logoPicture(gen('a.avif'));
    const foreignSecond = check(
      page(clean + logoPicture('/foreign/logo.avif'))
    );
    expect(foreignSecond.failures.join('\n')).toMatch(
      /serves bytes outside this generation/
    );
    expect(foreignSecond.mounted).toEqual([]);
    const cleanPair = check(page(clean + clean));
    expect(cleanPair.failures).toEqual([]);
    expect(cleanPair.mounted).toEqual([mount.binding]);
  });
});
