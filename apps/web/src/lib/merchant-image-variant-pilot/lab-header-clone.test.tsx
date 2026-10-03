import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderLogo } from '@/components/storefront/blocks/header-logo';
import {
  LabHeaderLogo,
  LabHeaderLogoFallback,
  LabStoreHeader,
} from './lab-header-clone';
import type { ApprovedPilotTier } from './lab-index';
import {
  type PilotImageSlot,
  projectControlNextImage,
  projectPilotNextImage,
} from './next-image-adapter';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // The mock bypasses the loader, so props.src is the raw URL the
    // original component passed in. The real loader appends inert ?w&q
    // to local paths; strip any query for the parity comparison.
    // Mirror the real default loading="lazy" for non-priority images so
    // React 19 SSR does not hoist a preload the real component never emits.
    const { loading, src, ...rest } = props;
    const { alt, ...imgRest } = rest;
    const bareSrc = String(src).split('?')[0];
    return (
      // biome-ignore lint/performance/noImgElement: next/image test double must render a DOM image.
      <img
        src={bareSrc}
        alt={alt as string}
        loading={((loading as string) ?? 'lazy') as 'eager' | 'lazy'}
        {...imgRest}
      />
    );
  },
}));

const CONTROL_URL = '/__pilot/originals/stores/test-store/logo.png';
const ORIGINAL_HTTPS = 'https://cdn.example.com/stores/test-store/logo.png';

const LOGO_SLOT: PilotImageSlot = {
  alt: 'Test Store',
  height: 40,
  sizes: '(max-width: 48px) 40px, 40px',
  width: 40,
};

function logoTier(format: 'avif' | 'webp', width: number): ApprovedPilotTier {
  return {
    actualWidth: width,
    bytes: 1000,
    contentType: format === 'avif' ? 'image/avif' : 'image/webp',
    delivery: 'generated',
    fileName: `logo-${width}w.${format}`,
    format,
    generationId: 'gen-test',
    height: width,
    quality: 70,
    requestedWidth: width,
    sha256: '0'.repeat(64),
    width,
  };
}

const PILOT_TIERS: ApprovedPilotTier[] = [
  logoTier('avif', 40),
  logoTier('avif', 80),
  logoTier('webp', 40),
  logoTier('webp', 80),
];

const PROPS = {
  getHref: (path: string) => `/test-store${path}`,
  layout: 'logo-left-nav-center' as const,
  storeName: 'Test Store',
};

function stripImageElement(html: string): string {
  // Collapse the whole image element — the <picture> wrapper, its format
  // <source> tiers, and the <img> — to one token. The pilot's explicit
  // picture (vs the original's next/image img) is the documented delta;
  // everything outside it must be identical.
  return html
    .replaceAll(/<picture[^>]*>[\s\S]*?<\/picture>/g, '<img/>')
    .replaceAll(/<img[^>]*>/g, '<img/>');
}

describe('LabHeaderLogo original-renderer parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches the original lockup structure modulo the image element (control projection)', () => {
    const control = projectControlNextImage({
      originalUrl: CONTROL_URL,
      slot: LOGO_SLOT,
    });
    const originalHtml = renderToStaticMarkup(
      <HeaderLogo
        storeName={PROPS.storeName}
        getHref={PROPS.getHref}
        layout={PROPS.layout}
        logoUrl={ORIGINAL_HTTPS}
      />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabHeaderLogo {...PROPS} projection={control} />
    );
    expect(stripImageElement(cloneHtml)).toBe(stripImageElement(originalHtml));
  });

  it('pilot arm differs from the original ONLY in the image element', () => {
    const pilot = projectPilotNextImage({
      baseUrl: CONTROL_URL,
      slot: LOGO_SLOT,
      tiers: PILOT_TIERS,
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const originalHtml = renderToStaticMarkup(
      <HeaderLogo
        storeName={PROPS.storeName}
        getHref={PROPS.getHref}
        layout={PROPS.layout}
        logoUrl={ORIGINAL_HTTPS}
      />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabHeaderLogo {...PROPS} projection={pilot} />
    );
    expect(stripImageElement(cloneHtml)).toBe(stripImageElement(originalHtml));
    // The documented delta: explicit immutable srcSets, no loader params.
    expect(cloneHtml).toContain('type="image/avif"');
    expect(cloneHtml).toContain(`${CONTROL_URL}/gen-test/logo-40w.avif 40w`);
    expect(cloneHtml).not.toContain('?w=');
  });

  it('control projection serves the staged original bytes (no loader params)', () => {
    const control = projectControlNextImage({
      originalUrl: CONTROL_URL,
      slot: LOGO_SLOT,
    });
    const cloneHtml = renderToStaticMarkup(
      <LabHeaderLogo {...PROPS} projection={control} />
    );
    expect(control.fallbackSrc).toBe(CONTROL_URL);
    expect(cloneHtml).toContain(`src="${CONTROL_URL}"`);
    expect(cloneHtml).not.toContain('?w=');
  });

  it('fallback clone matches the original Logo path', () => {
    const originalHtml = renderToStaticMarkup(
      <HeaderLogo
        storeName={PROPS.storeName}
        getHref={PROPS.getHref}
        layout={PROPS.layout}
        logoUrl={undefined}
      />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabHeaderLogoFallback {...PROPS} />
    );
    expect(cloneHtml).toBe(originalHtml);
  });

  it('lab header bar is a top landmark naming the store', () => {
    const html = renderToStaticMarkup(
      <LabStoreHeader storeName="Test Store">
        <span>lockup</span>
      </LabStoreHeader>
    );
    expect(html).toContain('<header');
    expect(html).toContain('data-pilot-lab-store-header="Test Store"');
  });
});
