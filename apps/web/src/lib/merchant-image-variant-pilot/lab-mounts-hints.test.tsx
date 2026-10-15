import { preload } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PilotLabCardPreload } from './lab-card-preload';
import { PilotLabFlightPreload } from './lab-flight-preload';
import type { ApprovedPilotTier } from './lab-index';
import { PilotLabScannerLink } from './lab-scanner-link';
import { projectPilotNextImage } from './next-image-adapter';
import { projectPilotOgabasseyMobile } from './ogabassey-mobile-adapter';

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
