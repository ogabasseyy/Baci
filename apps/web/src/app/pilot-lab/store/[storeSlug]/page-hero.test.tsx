import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeLabRuntime } from '../../lab-route';
import { type LabTestAsset, setupLabRoots } from '../../lab-test-roots';
import PilotLabStoreRoute from './page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'localhost:3101' })),
}));

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, preload: vi.fn() };
});

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// Real getImageProps (the control hero derivation + the original carousel
// run the production loader chain); terminal <Image> is a passthrough.
vi.mock('next/image', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/image')>();
  return {
    ...original,
    default: (props: Record<string, unknown>) => {
      const {
        alt,
        blurDataURL: _blur,
        fill: _fill,
        loading,
        placeholder: _ph,
        preload: _preload,
        quality: _quality,
        src,
        ...rest
      } = props;
      void _blur;
      void _fill;
      void _ph;
      void _preload;
      void _quality;
      return (
        // biome-ignore lint/performance/noImgElement: next/image test double must render a DOM image.
        <img
          src={String(src).split('?')[0]}
          alt={alt as string}
          loading={((loading as string) ?? 'lazy') as 'eager' | 'lazy'}
          {...rest}
        />
      );
    },
  };
});

vi.mock('@/components/themed', () => ({
  ThemedCard: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  ThemedButton: ({
    children,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button type="button" disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount}`,
  }),
}));

vi.mock('@/lib/seo-utils', () => ({
  getProductUrl: (input: { id: string }) => `/product/${input.id}`,
}));

const OMNIMART = 'de968340-de02-4aa8-95f9-9d5f7d2b1f20';
const SQUISHY = 'ce33cde7-fb48-4a6e-9742-e8ed4e2d137f';
const ZORVEXA = 'da7e7edf-a84f-4cdb-8a51-52d8722e7f6f';
const OGABASSEY = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function fullInventory(): LabTestAsset[] {
  return [
    {
      assetId: 'omnimart-logo',
      ladder: [96, 192, 384],
      merchantId: OMNIMART,
      role: 'logo',
      slot: 'header-logo',
      url: 'https://cdn.example.com/media/omnimart-logo.png',
    },
    {
      assetId: 'omnimart-earbuds',
      ladder: [384, 768, 1280],
      merchantId: OMNIMART,
      role: 'product',
      slot: 'product-card',
      url: 'https://cdn.example.com/media/omnimart-earbuds.png',
    },
    {
      assetId: 'squishy-blue-soap',
      ladder: [384, 768, 1280],
      merchantId: SQUISHY,
      role: 'product',
      slot: 'product-card',
      url: 'https://cdn.example.com/media/squishy-blue-soap.jpg',
    },
    {
      assetId: 'zorvexa-logo',
      ladder: [96, 192, 384],
      merchantId: ZORVEXA,
      role: 'logo',
      slot: 'header-logo',
      url: 'https://cdn.example.com/media/zorvexa-logo.png',
    },
    {
      assetId: 'zorvexa-yodha',
      ladder: [384, 768, 1280],
      merchantId: ZORVEXA,
      role: 'product',
      slot: 'product-card',
      url: 'https://cdn.example.com/media/zorvexa-yodha.png',
    },
    {
      assetId: 'ogabassey-hero-s26',
      ladder: [384, 768, 1280],
      merchantId: OGABASSEY,
      role: 'hero',
      slot: 'mobile-hero-slide-0',
      url: 'https://cdn.example.com/media/ogabassey-hero-s26.avif',
    },
  ];
}

async function setupFullRoots() {
  const roots = await setupLabRoots({ accepted: fullInventory() });
  vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
  vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
  vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
  vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
  await initializeLabRuntime();
  return roots;
}

async function renderStore(storeSlug: string, arm?: string): Promise<string> {
  const element = await PilotLabStoreRoute({
    params: Promise.resolve({ storeSlug }),
    searchParams: Promise.resolve(arm === undefined ? {} : { arm }),
  });
  return renderToStaticMarkup(element);
}

describe('pilot-lab store routes', () => {
  afterEach(() => {
    Reflect.deleteProperty(
      globalThis,
      Symbol.for('baci.merchant-image-pilot.runtime')
    );
    vi.unstubAllEnvs();
  });

  it('mounts the ogabassey pilot hero in the carousel shell', async () => {
    const roots = await setupFullRoots();
    const html = await renderStore('ogabassey', 'pilot');
    expect(html).toContain(
      `data-pilot-lab-binding="${OGABASSEY}/ogabassey-hero-s26"`
    );
    expect(html).toContain('data-ogabassey-mobile-hero="true"');
    expect(html).toContain('Go to hero slide 2');
    expect(html).toContain('data-pilot-lab-hero-slide="0"');
    expect(html).toContain(
      `/__pilot/${roots.generationIds['ogabassey-hero-s26']}/`
    );
    expect(html).toContain('type="image/avif"');
    expect(html).not.toContain('?w=');
    // The scanner link carries the binding identity the served gate pairs
    // by (React hoists it to <head>, out of the section).
    const pilotLink = html.match(
      /<link[^>]*data-pilot-lab-preload="pilot"[^>]*>/
    );
    if (!pilotLink) {
      throw new Error('pilot scanner link is missing');
    }
    expect(pilotLink[0]).toContain(
      `data-pilot-lab-binding="${OGABASSEY}/ogabassey-hero-s26"`
    );
  });

  it('matches the ogabassey control hint to the original render', async () => {
    await setupFullRoots();
    const html = await renderStore('ogabassey', 'control');
    expect(html).toContain('data-ogabassey-mobile-hero="true"');
    // Original renderer: no lab slide marker.
    expect(html).not.toContain('data-pilot-lab-hero-slide');
    // Control scanner link is format-agnostic (no AVIF gate).
    const linkMatch = html.match(
      /<link[^>]*data-pilot-lab-preload="control"[^>]*>/
    );
    if (!linkMatch) {
      throw new Error('control scanner link is missing');
    }
    expect(linkMatch[0]).not.toContain('type=');
    expect(linkMatch[0]).toContain('?w=');
    // The derived hint preloads exactly what the original paints.
    const hintSrcSet = linkMatch[0].match(/imageSrcSet="([^"]+)"/)?.[1];
    const renderedSrcSet = html.match(
      /<source[^>]*srcSet="([^"]+)"[^>]*>/
    )?.[1];
    expect(hintSrcSet).toBeDefined();
    expect(renderedSrcSet).toBeDefined();
    expect(hintSrcSet).toBe(renderedSrcSet);
  });
});
