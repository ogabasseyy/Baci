import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovedPilotTier } from './lab-index';
import { PilotLabMobileMount } from './lab-mobile-mount';
import {
  projectControlOgabasseyMobile,
  projectPilotOgabasseyMobile,
} from './ogabassey-mobile-adapter';

type ReactDomModule = typeof import('react-dom');

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<ReactDomModule>();
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
    // Format-honest picture: the pilot gates AVIF bytes by type, while the
    // control serves the original untyped (an AVIF gate over PNG/JPEG bytes
    // would break decoding in AVIF-capable browsers).
    if (arm === 'pilot') {
      expect(sources[0]).toContain('type="image/avif"');
    } else {
      expect(sources[0]).not.toContain('type=');
    }
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
