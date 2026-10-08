import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeLabRuntime } from '../../../../lab-route';
import { type LabTestAsset, setupLabRoots } from '../../../../lab-test-roots';
import PilotLabStoreRoute from '../../page';
import PilotLabFixtureProductRoute from './page';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'lab.invalid:3101' })),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// Real getImageProps; terminal <Image> is a passthrough.
vi.mock('next/image', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/image')>();
  return {
    ...original,
    default: (props: Record<string, unknown>) => {
      const { alt, src } = props;
      return (
        // biome-ignore lint/performance/noImgElement: next/image test double must render a DOM image.
        <img src={String(src).split('?')[0]} alt={alt as string} />
      );
    },
  };
});

vi.mock('@/components/themed', () => ({
  ThemedCard: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ThemedButton: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount}`,
  }),
}));

// NOTE: no @/lib/seo-utils mock here — this test must exercise the REAL
// product-href chain so the derived slugs match what browsers prefetch.

const OMNIMART = 'de968340-de02-4aa8-95f9-9d5f7d2b1f20';

async function setupRoots() {
  const asset: LabTestAsset = {
    assetId: 'omnimart-earbuds',
    generationId: 'd'.repeat(64),
    ladder: [384, 768, 1280],
    merchantId: OMNIMART,
    role: 'product',
    slot: 'product-card',
    url: 'https://cdn.example.com/media/omnimart-earbuds.png',
  };
  const roots = await setupLabRoots({ accepted: [asset] });
  vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
  vi.stubEnv('BACI_IMAGE_PILOT_INPUT_ROOT', roots.inputRoot);
  vi.stubEnv('BACI_IMAGE_PILOT_OUTPUT_ROOT', roots.outputRoot);
  vi.stubEnv('BACI_IMAGE_PILOT_PUBLIC_DIR', roots.publicDir);
  await initializeLabRuntime();
}

async function renderStore(): Promise<string> {
  const element = await PilotLabStoreRoute({
    params: Promise.resolve({ storeSlug: 'omnimart' }),
    searchParams: Promise.resolve({ arm: 'pilot' }),
  });
  return renderToStaticMarkup(element);
}

function labCategorySlugs(html: string): string[] {
  const slugs: string[] = [];
  for (const match of html.matchAll(
    /\/pilot-lab\/store\/omnimart\/lab-category\/([a-z0-9-]+)/g
  )) {
    slugs.push(match[1]);
  }
  return [...new Set(slugs)];
}

describe('pilot lab fixture product route', () => {
  afterEach(() => {
    Reflect.deleteProperty(
      globalThis,
      Symbol.for('baci.merchant-image-pilot.runtime')
    );
    vi.unstubAllEnvs();
  });

  it('serves every card href the grid renders (no prefetch 404s)', async () => {
    await setupRoots();
    // Mounted card + 3 fillers link here with default Link prefetching.
    const slugs = labCategorySlugs(await renderStore());
    expect(slugs.length).toBeGreaterThanOrEqual(4);
    for (const productSlug of slugs) {
      const element = await PilotLabFixtureProductRoute({
        params: Promise.resolve({ productSlug, storeSlug: 'omnimart' }),
      });
      const html = renderToStaticMarkup(element);
      expect(html).toContain('data-pilot-lab-fixture-product="true"');
      expect(html).toContain(productSlug);
    }
  });

  it('404s unknown stores and a disabled flag', async () => {
    await setupRoots();
    await expect(
      PilotLabFixtureProductRoute({
        params: Promise.resolve({
          productSlug: 'lab-filler-two',
          storeSlug: 'dell',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    await expect(
      PilotLabFixtureProductRoute({
        params: Promise.resolve({
          productSlug: 'lab-filler-two',
          storeSlug: 'omnimart',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
