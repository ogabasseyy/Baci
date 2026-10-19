import { Suspense } from 'react';
import { renderToReadableStream } from 'react-dom/server.edge';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyHomeDiscoverySection } from './ogabassey-home-discovery-section';
import {
  createSectionProduct,
  mockSectionMerchant,
} from './ogabassey-home-section.test-fixtures';

vi.mock(import('@/lib/cached-data'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCachedStorefrontHomeProducts: vi.fn(() => Promise.resolve([])),
    getCachedStorefrontLaunchProducts: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('@/lib/cached-storefront-products-by-slugs', () => ({
  getCachedStorefrontProductsBySlugs: vi.fn(() => Promise.resolve([])),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('OgabasseyHomeDiscoverySection streaming order', () => {
  it('places the hero before the discovery section in the streamed Fizz HTML via the macrotask yield', async () => {
    async function MultiMicrotaskHero() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      return <section data-testid="streamed-hero">Hero Banner</section>;
    }

    const stream = await renderToReadableStream(
      <div>
        <Suspense fallback={<div data-testid="discovery-fallback" />}>
          <OgabasseyHomeDiscoverySection
            categoriesPromise={Promise.resolve([])}
            launchProductsPromise={Promise.resolve([])}
            merchant={mockSectionMerchant}
            pathPrefix="/ogabassey"
            productsPromise={Promise.resolve([createSectionProduct()])}
          />
        </Suspense>
        <Suspense fallback={<div data-testid="hero-fallback" />}>
          <MultiMicrotaskHero />
        </Suspense>
      </div>
    );

    const html = await new Response(stream).text();
    expect(html.indexOf('Hero Banner')).toBeGreaterThan(-1);
    expect(html.indexOf('iphone-17-pro-max')).toBeGreaterThan(-1);
    expect(html.indexOf('Hero Banner')).toBeLessThan(
      html.indexOf('iphone-17-pro-max')
    );
  });
});
