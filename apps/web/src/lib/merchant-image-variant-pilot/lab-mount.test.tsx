import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectControlCssHero, projectPilotCssHero } from './css-hero-adapter';
import type { ApprovedPilotTier } from './lab-index';
import {
  PilotLabCardPreload,
  PilotLabCssHeroMount,
  PilotLabFlightPreload,
  PilotLabMobileMount,
  PilotLabNotOptimized,
  PilotLabPictureMount,
  PilotLabScannerLink,
} from './lab-mount';
import {
  projectControlNextImage,
  projectPilotNextImage,
} from './next-image-adapter';
import {
  projectControlOgabasseyMobile,
  projectPilotOgabasseyMobile,
} from './ogabassey-mobile-adapter';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, preload: vi.fn() };
});

const GENERATION_ID = 'a'.repeat(64);

function tiers(): ApprovedPilotTier[] {
  const rows: ApprovedPilotTier[] = [];
  for (const width of [96, 192, 384]) {
    for (const format of ['avif', 'webp'] as const) {
      rows.push({
        actualWidth: width,
        bytes: 1000 + width,
        contentType: `image/${format}`,
        delivery: 'generated',
        fileName: `tier-${width}.${format}`,
        format,
        generationId: GENERATION_ID,
        height: Math.round((width * 3) / 4),
        quality: 70,
        requestedWidth: width,
        sha256: 'b'.repeat(64),
        width,
      });
    }
  }
  return rows;
}

const MOBILE_SLOT = {
  alt: 'Lab hero slide 0',
  imageFit: 'contain' as const,
  media: '(max-width: 768px)',
  sizes: '(max-width: 768px) 40vw, 152px',
};

function srcSetWidths(srcSet: string): number[] {
  return [...srcSet.matchAll(/(\S+) (\d+)w/g)].map((match) => Number(match[2]));
}

function srcSetUrls(srcSet: string): string[] {
  return [...srcSet.matchAll(/(\S+) \d+w/g)].map((match) => match[1] ?? '');
}

function normalizeStructure(html: string): string {
  return html
    .replaceAll(/imageSrcSet="[^"]*"/g, 'imageSrcSet="X"')
    .replaceAll(/srcSet="[^"]*"/g, 'srcSet="X"')
    .replaceAll(/src="[^"]*"/g, 'src="X"')
    .replaceAll(/href="[^"]*"/g, 'href="X"')
    .replaceAll(/data-pilot-lab-\w+="[^"]*"/g, 'data-arm="X"')
    .replaceAll(/style="[^"]*"/g, 'style="X"')
    .replaceAll(/ type="[^"]*"/g, '');
}

describe('PilotLabMobileMount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pilot and control arms through the identical DOM structure', () => {
    const pilot = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: MOBILE_SLOT,
      tiers: tiers(),
    });
    const control = projectControlOgabasseyMobile({
      originalUrl: '/__pilot/originals/hero.png',
      slot: MOBILE_SLOT,
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const pilotHtml = renderToStaticMarkup(
      <PilotLabMobileMount
        arm="pilot"
        binding="lab-merchant/hero-s0"
        projection={pilot}
      />
    );
    const controlHtml = renderToStaticMarkup(
      <PilotLabMobileMount
        arm="control"
        binding="lab-merchant/hero-s0"
        projection={control}
        type={null}
      />
    );
    // Same adapter, same structure: only staged URLs/srcSets and the
    // format gate differ (control bytes are format-agnostic).
    expect(normalizeStructure(pilotHtml)).toBe(normalizeStructure(controlHtml));
    for (const html of [pilotHtml, controlHtml]) {
      expect(html.match(/<link /g)).toHaveLength(1);
      expect(html.match(/<picture/g)).toHaveLength(1);
      expect(html.match(/<source /g)).toHaveLength(2);
      expect(html.match(/<img /g)).toHaveLength(1);
    }
    // The pilot arm serves width-described candidates; the control arm
    // serves the mounted original bytes.
    expect(pilotHtml).toMatch(/96w.*192w.*384w/s);
    expect(controlHtml).toContain('/__pilot/originals/hero.png');
  });

  it.each([
    'pilot',
    'control',
  ] as const)('feeds every hint owner from the rendered %s projection', (arm) => {
    const pilot = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: MOBILE_SLOT,
      tiers: tiers(),
    });
    const control = projectControlOgabasseyMobile({
      originalUrl: '/__pilot/originals/hero.png',
      slot: MOBILE_SLOT,
    });
    const projection = arm === 'pilot' ? pilot : control;
    if (!projection) {
      throw new Error('projection is null');
    }
    const html = renderToStaticMarkup(
      <PilotLabMobileMount
        arm={arm}
        binding="lab-merchant/hero-s0"
        projection={projection}
        type={arm === 'control' ? null : undefined}
      />
    );

    // Flight-preload owner: the react-dom call carries the projection.
    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledWith(projection.preload.href, {
      as: 'image',
      fetchPriority: 'high',
      imageSizes: projection.preload.imageSizes,
      imageSrcSet: projection.preload.imageSrcSet,
      media: projection.preload.media,
      type: arm === 'pilot' ? 'image/avif' : undefined,
    });

    // Scanner-link owner: attributes equal the flight preload exactly.
    const link = html.match(/<link ([^>]+)>/)?.[1] ?? '';
    expect(link).toContain(`href="${projection.preload.href}"`);
    expect(link).toContain(`imageSrcSet="${projection.preload.imageSrcSet}"`);
    expect(link).toContain(`imageSizes="${projection.preload.imageSizes}"`);
    expect(link).toContain(`media="${projection.preload.media}"`);
    if (arm === 'pilot') {
      expect(link).toContain('type="image/avif"');
    } else {
      expect(link).not.toContain('type=');
    }

    // Rendered-picture owner: the AVIF source is byte-identical to the
    // preloaded srcSet so preload matching dedupes them into one fetch.
    const sources = [...html.matchAll(/<source ([^>]+)>/g)].map(
      (match) => match[1]
    );
    expect(sources).toHaveLength(2);
    expect(sources[0]).toContain(`srcSet="${projection.preload.imageSrcSet}"`);
    expect(sources[0]).toContain(`sizes="${projection.preload.imageSizes}"`);
    expect(sources[0]).toContain(`media="${projection.preload.media}"`);
    expect(sources[0]).toContain('type="image/avif"');
    expect(sources[1]).toContain(`srcSet="${projection.fallbackSrcSet}"`);

    // The preload href is one of the preloaded candidates.
    expect(
      srcSetUrls(projection.preload.imageSrcSet).length > 0
        ? srcSetUrls(projection.preload.imageSrcSet)
        : [projection.preload.imageSrcSet]
    ).toContain(projection.preload.href);
  });

  it('maps object-fit exactly like the mounted hero renderer', () => {
    const tiersList = tiers();
    const contain = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: MOBILE_SLOT,
      tiers: tiersList,
    });
    const cover = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: { ...MOBILE_SLOT, imageFit: 'cover' },
      tiers: tiersList,
    });
    if (!contain || !cover) {
      throw new Error('pilot projection is null');
    }
    expect(contain.imageFit).toBe('contain');
    expect(cover.imageFit).toBe('cover');
    const containHtml = renderToStaticMarkup(
      <PilotLabMobileMount
        arm="pilot"
        binding="lab-merchant/hero-s0"
        projection={contain}
      />
    );
    const coverHtml = renderToStaticMarkup(
      <PilotLabMobileMount
        arm="pilot"
        binding="lab-merchant/hero-s0"
        projection={cover}
      />
    );
    expect(containHtml).toContain('object-contain object-right');
    expect(containHtml).not.toContain('object-cover');
    expect(coverHtml).toContain('object-cover');
    expect(coverHtml).not.toContain('object-contain');
  });

  it('emits width descriptors matching the actual encoded tiers', () => {
    const pilot = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: MOBILE_SLOT,
      tiers: tiers(),
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    expect(srcSetWidths(pilot.avifSrcSet)).toEqual([96, 192, 384]);
    expect(srcSetWidths(pilot.fallbackSrcSet)).toEqual([96, 192, 384]);
    const html = renderToStaticMarkup(
      <PilotLabMobileMount
        arm="pilot"
        binding="lab-merchant/hero-s0"
        projection={pilot}
      />
    );
    expect(srcSetWidths(html)).toEqual(expect.arrayContaining([96, 192, 384]));
  });
});

describe('PilotLabPictureMount', () => {
  const slot = {
    alt: 'Lab product',
    height: 288,
    sizes: '50vw',
    width: 384,
  };

  it('renders pilot and control arms through the identical DOM structure', () => {
    const pilot = projectPilotNextImage({
      baseUrl: '/__pilot',
      slot,
      tiers: tiers(),
    });
    const control = projectControlNextImage({
      originalUrl: '/__pilot/originals/product.png',
      slot,
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const pilotHtml = renderToStaticMarkup(
      <PilotLabPictureMount arm="pilot" projection={pilot} />
    );
    const controlHtml = renderToStaticMarkup(
      <PilotLabPictureMount arm="control" projection={control} />
    );
    expect(normalizeStructure(pilotHtml)).toBe(normalizeStructure(controlHtml));
    expect(pilotHtml).toMatch(/96w.*192w.*384w/s);
    expect(controlHtml).toContain('/__pilot/originals/product.png');
  });
});

describe('PilotLabCssHeroMount', () => {
  const breakpoints = [
    { media: '(max-width: 768px)', requestedWidth: 384 },
    { media: '(min-width: 769px)', requestedWidth: 768 },
  ];
  // The 768 breakpoint needs a tier at or above its requested width.
  const wideTiers = () =>
    tiers().map((tier) =>
      tier.width === 384
        ? { ...tier, actualWidth: 800, height: 600, width: 800 }
        : tier
    );

  it('renders one layer per breakpoint with both staged formats', () => {
    const pilot = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints,
      slot: { cover: true, overlay: true },
      tiers: wideTiers(),
    });
    const control = projectControlCssHero({
      breakpoints,
      originalUrl: '/__pilot/originals/hero-bg.png',
      slot: { cover: true, overlay: true },
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const pilotHtml = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={pilot} />
    );
    const controlHtml = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={control} />
    );
    expect(pilotHtml.match(/data-pilot-lab-css-layer/g)).toHaveLength(2);
    expect(pilotHtml).toContain('tier-384.avif');
    expect(pilotHtml).toContain('tier-384.webp');
    expect(controlHtml).toContain('/__pilot/originals/hero-bg.png');
  });

  it('gates every layer behind its own media query', () => {
    const pilot = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints,
      slot: { cover: true, overlay: true },
      tiers: wideTiers(),
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const html = renderToStaticMarkup(
      <PilotLabCssHeroMount projection={pilot} />
    );
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(style).toContain('@media (max-width: 768px)');
    expect(style).toContain('@media (min-width: 769px)');
    expect(style).toContain('image-set(');
    // Layers carry no inline style: viewports download only the tiers
    // their media query selects.
    expect(html).not.toContain('style="');
    // Progressive enhancement: a plain WebP background-image precedes the
    // image-set so browsers without image-set still paint the hero.
    const layer = style.match(/\.plab-css-layer-0\{([^}]*)\}/)?.[1] ?? '';
    expect(layer).toMatch(
      /background-image:url\("[^"]+\.webp"\);background-image:image-set\(/
    );
  });

  it('refuses to emit unscoped media', () => {
    const pilot = projectPilotCssHero({
      baseUrl: '/__pilot',
      breakpoints,
      slot: { cover: true, overlay: true },
      tiers: wideTiers(),
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const hostile = {
      ...pilot,
      breakpoints: [{ ...pilot.breakpoints[0], media: 'x"};evil{}/*' }],
    };
    expect(() =>
      renderToStaticMarkup(<PilotLabCssHeroMount projection={hostile} />)
    ).toThrow(/refusing to emit unscoped CSS media/);
  });
});

describe('PilotLab hint owners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mobileProjection() {
    const pilot = projectPilotOgabasseyMobile({
      baseUrl: '/__pilot',
      slot: MOBILE_SLOT,
      tiers: tiers(),
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    return pilot;
  }

  it('scanner link defaults to the projection AVIF type gate', () => {
    const html = renderToStaticMarkup(
      <PilotLabScannerLink
        arm="pilot"
        binding="lab-merchant/hero-s0"
        projection={mobileProjection()}
      />
    );
    expect(html).toContain('type="image/avif"');
    expect(html).toContain('data-pilot-lab-preload="pilot"');
    expect(html).toContain('data-pilot-lab-binding="lab-merchant/hero-s0"');
  });

  it('scanner link omits type for format-agnostic control bytes', () => {
    const html = renderToStaticMarkup(
      <PilotLabScannerLink
        arm="control"
        binding="lab-merchant/hero-s0"
        projection={mobileProjection()}
        type={null}
      />
    );
    expect(html).not.toContain('type=');
    expect(html).toContain('data-pilot-lab-preload="control"');
  });

  it('flight preload passes the type override through to react-dom', () => {
    renderToStaticMarkup(
      <PilotLabFlightPreload projection={mobileProjection()} type={null} />
    );
    expect(preload).toHaveBeenCalledOnce();
    expect(preload).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ as: 'image', type: undefined })
    );
  });

  it('card preload is flight-only with the AVIF srcSet', () => {
    const pilot = projectPilotNextImage({
      baseUrl: '/__pilot',
      slot: {
        alt: 'Lab card',
        fetchPriority: 'high',
        height: 400,
        loading: 'eager',
        sizes: '50vw',
        width: 600,
      },
      tiers: tiers(),
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const html = renderToStaticMarkup(
      <PilotLabCardPreload projection={pilot} />
    );
    expect(html).toBe('');
    expect(preload).toHaveBeenCalledOnce();
    const [href, options] = (preload as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, Record<string, string>];
    expect(href).toContain('tier-96.avif');
    expect(options.imageSrcSet).toContain('tier-384.avif 384w');
    expect(options.type).toBe('image/avif');
    expect(options.fetchPriority).toBe('high');
  });
});

describe('PilotLabNotOptimized', () => {
  it('marks the binding slot as reported-not-optimized', () => {
    const html = renderToStaticMarkup(
      <PilotLabNotOptimized
        binding={{
          assetId: 'logo-a',
          merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20',
          originalUrl: 'https://cdn.example.com/media/logo-a.png',
          role: 'logo',
          slotId: 'header-logo',
          sourceSha256: '0'.repeat(64),
        }}
        reason="binding status &quot;missing-acceptance&quot;; excluded."
      />
    );
    expect(html).toContain('data-pilot-lab-status="not-optimized"');
    expect(html).toContain('data-pilot-lab-slot="header-logo"');
    expect(html).toContain('logo-a — not optimized');
  });
});
