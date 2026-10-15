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

// Every fetched image URL in served markup: img src/srcset, source srcset,
// and preload link href/imagesrcset — relativized (origin + query stripped)
// so arms compare by staged path. JSON flight payloads are not consumers.
function labImageConsumers(html: string): string[] {
  const urls: string[] = [];
  const tags = html.match(/<(?:img|source|link)\b[^>]*>/g) ?? [];
  for (const tag of tags) {
    const attrs = [...tag.matchAll(/([\w-]+)="([^"]*)"/g)];
    for (const [, name, value] of attrs) {
      if (!['src', 'srcset', 'href', 'imagesrcset'].includes(name)) {
        continue;
      }
      for (const candidate of value.split(',')) {
        const url = candidate.trim().split(' ')[0] ?? '';
        if (!url) {
          continue;
        }
        const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        urls.push(path);
      }
    }
  }
  return urls;
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

  it('renders nothing when the lab flag is off', async () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    await expect(renderStore('omnimart', 'pilot')).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
  });

  it('404s unknown store slugs', async () => {
    await setupFullRoots();
    await expect(renderStore('dell', 'pilot')).rejects.toThrow(
      'NEXT_NOT_FOUND'
    );
  });

  it('404s unknown ?arm values instead of silently rendering pilot', async () => {
    await setupFullRoots();
    for (const arm of ['Pilot', 'both', '']) {
      await expect(renderStore('omnimart', arm)).rejects.toThrow(
        'NEXT_NOT_FOUND'
      );
    }
  });

  it('never reflects a spoofed Host into card image URLs', async () => {
    const roots = await setupFullRoots();
    const { headers } = await import('next/headers');
    vi.mocked(headers).mockResolvedValueOnce(
      new Headers({ host: 'evil.invalid' })
    );
    const html = await renderStore('omnimart', 'pilot');
    expect(html).not.toContain('evil.invalid');
    // Untrusted hosts fall back to the loopback default.
    expect(html).toContain(
      `http://localhost:3000/__pilot/${roots.generationIds['omnimart-earbuds']}/`
    );
  });

  it('gives the pilot candidate no consumer of the selected original', async () => {
    await setupFullRoots();
    // Fillers must not re-fetch the selected original: in the pilot arm the
    // candidate would otherwise download the original PLUS its derivatives,
    // swamping the byte-saving comparison the grid exists to measure.
    const selectedPrefix = `/__pilot/originals/${OMNIMART}-omnimart-earbuds`;
    const pilot = labImageConsumers(await renderStore('omnimart', 'pilot'));
    expect(pilot.filter((url) => url.startsWith(selectedPrefix))).toEqual([]);
    // Fillers render the frozen filler assets instead, identical in both
    // arms — one distinct URL per sibling card, since shared URLs would
    // coalesce into a single browser request.
    const fillers = [
      '/__pilot/fillers/grid-filler-600x400-a.png',
      '/__pilot/fillers/grid-filler-600x400-b.png',
      '/__pilot/fillers/grid-filler-600x400-c.png',
    ];
    for (const filler of fillers) {
      expect(pilot.filter((url) => url === filler).length).toBeGreaterThan(0);
    }
    const control = labImageConsumers(await renderStore('omnimart', 'control'));
    for (const filler of fillers) {
      expect(control.filter((url) => url === filler).length).toBeGreaterThan(0);
    }
    // The control mounted card still serves the selected original.
    expect(
      control.filter((url) => url.startsWith(selectedPrefix)).length
    ).toBeGreaterThan(0);
  });

  it('wraps the mounted card for selected-card coverage identity', async () => {
    await setupFullRoots();
    for (const arm of ['pilot', 'control'] as const) {
      const html = await renderStore('omnimart', arm);
      // Exactly one selected wrapper per grid; the served gate scopes the
      // binding check to this subtree so fillers can never satisfy it.
      expect(html.match(/data-pilot-lab-selected-card="true"/g)).toHaveLength(
        1
      );
    }
  });
});
