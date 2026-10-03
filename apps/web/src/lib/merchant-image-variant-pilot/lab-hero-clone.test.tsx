import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroMobileCarousel } from '@/components/storefront/ogabassey/components/hero-mobile-carousel';
import {
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_SOURCE_MEDIA,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import type { LaunchProductSlide } from '@/components/storefront/ogabassey/components/LaunchCarousel';
import {
  LabHeroMobileCarousel,
  labHeroSlides,
  labHeroSlot,
} from './lab-hero-clone';
import type { ApprovedPilotTier } from './lab-index';
import {
  projectControlOgabasseyMobile,
  projectPilotOgabasseyMobile,
} from './ogabassey-mobile-adapter';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// Keep the REAL getImageProps (the original's MobileLcpHeroImage loader
// chain runs unmocked on the staged URL); only the terminal <Image> for
// non-prioritized slides is a passthrough.
vi.mock('next/image', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/image')>();
  return {
    ...original,
    default: (props: Record<string, unknown>) => {
      const { alt, fill: _fill, src, ...rest } = props;
      void _fill;
      return (
        // biome-ignore lint/performance/noImgElement: next/image test double must render a DOM image.
        <img src={String(src).split('?')[0]} alt={alt as string} {...rest} />
      );
    },
  };
});

const CONTROL_URL = '/__pilot/originals/stores/ogabassey/hero-s26.avif';

function heroTier(format: 'avif' | 'webp', width: number): ApprovedPilotTier {
  return {
    actualWidth: width,
    bytes: 1000,
    contentType: format === 'avif' ? 'image/avif' : 'image/webp',
    delivery: 'generated',
    fileName: `hero-${width}w.${format}`,
    format,
    generationId: 'gen-test',
    height: Math.round((width * 540) / 960),
    quality: 70,
    requestedWidth: width,
    sha256: '0'.repeat(64),
    width,
  };
}

const PILOT_TIERS: ApprovedPilotTier[] = [
  heroTier('avif', 384),
  heroTier('avif', 768),
  heroTier('webp', 384),
  heroTier('webp', 768),
];

function slides(imageUrl: string): LaunchProductSlide[] {
  return labHeroSlides({
    basePath: '/pilot-lab/store/ogabassey',
    slide0: {
      imageAlt: 'Lab hero product',
      imageUrl,
      name: 'Lab Hero Product',
    },
    slide1: {
      imageAlt: 'Lab hero filler',
      imageUrl,
      name: 'Lab Hero Filler',
    },
  });
}

function stripSlide0Picture(html: string): string {
  // Only slide-0 renders a <picture> at SSR (non-current slides render
  // nothing), so the global collapse is exactly the slide-0 delta.
  return html.replaceAll(
    /<picture[^>]*>[\s\S]*?<\/picture>/g,
    '<slide0-image/>'
  );
}

describe('LabHeroMobileCarousel original-renderer parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches the original carousel structure modulo the slide-0 image (control projection)', () => {
    const control = projectControlOgabasseyMobile({
      originalUrl: CONTROL_URL,
      slot: labHeroSlot('Lab hero product'),
    });
    const originalHtml = renderToStaticMarkup(
      <HeroMobileCarousel slides={slides(CONTROL_URL)} />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabHeroMobileCarousel
        slides={slides(CONTROL_URL)}
        slide0Projection={control}
      />
    );
    expect(stripSlide0Picture(cloneHtml)).toBe(
      stripSlide0Picture(originalHtml)
    );
  });

  it('pilot arm differs from the original ONLY in the slide-0 image', () => {
    const pilot = projectPilotOgabasseyMobile({
      baseUrl: CONTROL_URL,
      slot: labHeroSlot('Lab hero product'),
      tiers: PILOT_TIERS,
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const originalHtml = renderToStaticMarkup(
      <HeroMobileCarousel slides={slides(CONTROL_URL)} />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabHeroMobileCarousel
        slides={slides(CONTROL_URL)}
        slide0Projection={pilot}
      />
    );
    expect(stripSlide0Picture(cloneHtml)).toBe(
      stripSlide0Picture(originalHtml)
    );
    // The documented delta: explicit immutable tier srcSets, no loader params.
    expect(cloneHtml).toContain('type="image/avif"');
    expect(cloneHtml).toContain(`${CONTROL_URL}/gen-test/hero-384w.avif 384w`);
    expect(cloneHtml).not.toContain('?w=');
  });

  it('preserves the slide-0 LCP contract (sync/high/eager, transparent img, media)', () => {
    const pilot = projectPilotOgabasseyMobile({
      baseUrl: CONTROL_URL,
      slot: labHeroSlot('Lab hero product'),
      tiers: PILOT_TIERS,
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const cloneHtml = renderToStaticMarkup(
      <LabHeroMobileCarousel
        slides={slides(CONTROL_URL)}
        slide0Projection={pilot}
      />
    );
    expect(cloneHtml).toContain('decoding="sync"');
    expect(cloneHtml).toContain('fetchPriority="high"');
    expect(cloneHtml).toContain('loading="eager"');
    expect(cloneHtml).toContain('src="data:image/gif;base64,');
    expect(cloneHtml).toContain(
      'class="h-full w-full object-contain object-right"'
    );
    expect(cloneHtml).toContain(`media="${MOBILE_HERO_SOURCE_MEDIA}"`);
    expect(cloneHtml).toContain(`sizes="${MOBILE_HERO_IMAGE_SIZES}"`);
  });

  it('renders the multi-slide shell with no slide-1 image at SSR', () => {
    const control = projectControlOgabasseyMobile({
      originalUrl: CONTROL_URL,
      slot: labHeroSlot('Lab hero product'),
    });
    const cloneHtml = renderToStaticMarkup(
      <LabHeroMobileCarousel
        slides={slides(CONTROL_URL)}
        slide0Projection={control}
      />
    );
    expect(cloneHtml).toContain('Go to hero slide 1');
    expect(cloneHtml).toContain('Go to hero slide 2');
    // One picture (slide-0); the filler slide renders text + link only.
    expect(cloneHtml.match(/<picture/g)).toHaveLength(1);
    expect(cloneHtml).toContain('Lab Hero Filler');
  });

  it('control projection serves the staged original bytes', () => {
    const control = projectControlOgabasseyMobile({
      originalUrl: CONTROL_URL,
      slot: labHeroSlot('Lab hero product'),
    });
    expect(control.fallbackSrcSet).toBe(CONTROL_URL);
    expect(control.preload.href).toBe(CONTROL_URL);
  });

  it('links hero CTAs at the lab-category fixture route, never a missing product route', () => {
    const [slide0, slide1] = slides(CONTROL_URL);
    expect(slide0.href).toBe(
      '/pilot-lab/store/ogabassey/lab-category/lab-hero-slide-0'
    );
    expect(slide1.href).toBe(
      '/pilot-lab/store/ogabassey/lab-category/lab-hero-slide-1'
    );
  });
});
