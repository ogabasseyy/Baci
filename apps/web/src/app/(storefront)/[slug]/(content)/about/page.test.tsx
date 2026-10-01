import { render, screen, waitFor } from '@testing-library/react';
import { headers } from 'next/headers';
import { type ReactNode, Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMerchantByIdentifier } from '@/lib/cached-data';

const mockBuildMerchantTrustProfile = vi.fn();
const { mockConnection } = vi.hoisted(() => ({
  mockConnection: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: vi.fn(() => null),
}));

// The About page is imported directly by the route; stub it to keep the
// heavy page module out of this test's module graph.
vi.mock('@/components/storefront/ogabassey/pages/about-us', () => ({
  OgabasseyV2AboutUs: vi.fn(() => null),
}));

vi.mock('@/lib/storefront-trust/build-merchant-trust-profile', () => ({
  buildMerchantTrustProfile: (...args: unknown[]) =>
    mockBuildMerchantTrustProfile(...args),
}));

vi.mock('@/types/about-page', async () => {
  const actual =
    await vi.importActual<typeof import('@/types/about-page')>(
      '@/types/about-page'
    );
  return {
    ...actual,
    generateAboutPageJsonLd: vi.fn(actual.generateAboutPageJsonLd),
  };
});

vi.mock('../pages/about/about-page-client', () => ({
  AboutPageClient: ({ children }: { children?: ReactNode }) => (
    <div data-testid="about-client">About UI{children}</div>
  ),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { default: AboutPage, generateMetadata } = await import('./page');
const { AboutJsonLd } = await import('./about-json-ld');
const mockedGenerateAboutPageJsonLd = vi.mocked(
  (await import('@/types/about-page')).generateAboutPageJsonLd
);

describe('AboutPage', () => {
  beforeEach(() => {
    vi.mocked(getMerchantByIdentifier).mockReset();
    notFound.mockClear();
    mockBuildMerchantTrustProfile.mockReset();
  });

  it('does not emit a duplicate wrapper h1 while content is suspended', () => {
    // Deferred promise keeps async components suspended
    vi.mocked(getMerchantByIdentifier).mockReturnValue(
      new Promise<null>(() => {
        /* deferred: keep Suspense pending */
      })
    );

    render(
      <Suspense fallback={null}>
        <AboutPage params={Promise.resolve({ slug: 'test-store' })} />
      </Suspense>
    );

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('does not render a page-owned loading fallback while content is loading', () => {
    // Deferred promise — never resolves, so Suspense stays in fallback
    vi.mocked(getMerchantByIdentifier).mockReturnValue(
      new Promise<null>(() => {
        /* deferred: keep Suspense pending */
      })
    );

    render(
      <Suspense fallback={null}>
        <AboutPage params={Promise.resolve({ slug: 'test-store' })} />
      </Suspense>
    );

    expect(screen.queryByText('Loading about page...')).toBeNull();
  });

  it('threads the assembled trust profile into the AboutPage JSON-LD builder', async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Test Store',
      about_page: { story: 'Our story' },
      pages: {},
      logo_url: null,
      slug: 'test-store',
      custom_domain: null,
      country: 'NG',
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);
    mockBuildMerchantTrustProfile.mockReturnValue({
      supportEmail: 'support@test.example',
      supportPhone: '+2348000000000',
      foundedYear: 2020,
      socialLinks: {},
      derivedLinks: {},
    });

    render(
      await AboutJsonLd({
        params: Promise.resolve({ slug: 'test-store' }),
      })
    );

    await waitFor(() =>
      expect(mockBuildMerchantTrustProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          business_name: 'Test Store',
        }),
        'https://test-store.usebaci.com'
      )
    );

    expect(mockedGenerateAboutPageJsonLd).toHaveBeenCalledWith(
      expect.objectContaining({
        business_name: 'Test Store',
      }),
      expect.objectContaining({
        story: 'Our story',
      }),
      'https://test-store.usebaci.com',
      expect.objectContaining({
        socialLinks: {},
      })
    );

    const schemaScripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    const schemaScript = schemaScripts[schemaScripts.length - 1];
    expect(schemaScript).toBeDefined();
    const schema = JSON.parse(schemaScript?.textContent || '{}') as {
      url: string;
      mainEntity: Record<string, unknown>;
    };
    expect(schema.url).toBe('https://test-store.usebaci.com/about');
    expect(schema.mainEntity).toMatchObject({
      foundingDate: '2020',
      contactPoint: {
        email: 'support@test.example',
        telephone: '+2348000000000',
      },
    });
  });
});

describe('generateMetadata', () => {
  beforeEach(() => {
    vi.mocked(getMerchantByIdentifier).mockReset();
    vi.mocked(headers).mockResolvedValue(new Headers());
    notFound.mockClear();
    mockConnection.mockReset();
  });

  it('calls notFound when merchant is missing', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(null);

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: 'missing' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('returns fallback metadata when about content is empty', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Test Store',
      about_page: {},
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test' }),
    });

    expect(metadata.title).toBe('About Us | Test Store');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('returns metadata for the advertised about page when content is empty', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Test Store',
      about_page: {},
      pages: {},
      logo_url: null,
      slug: 'test-store',
      custom_domain: 'ogabassey.com',
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test' }),
    });

    expect(metadata.title).toBe('About Us | Test Store');
    expect(metadata.alternates?.canonical).toBe('https://ogabassey.com/about');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('returns metadata when about content exists', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Test Store',
      about_page: { story: 'Our story' },
      pages: {},
      logo_url: null,
      slug: 'test-store',
      custom_domain: 'ogabassey.com',
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test' }),
    });

    expect(metadata.title).toBe('About Us | Test Store');
    expect(metadata.alternates?.canonical).toBe('https://ogabassey.com/about');
    expect(metadata.openGraph?.url).toBe('https://ogabassey.com/about');
  });
});
