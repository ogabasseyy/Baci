import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseMerchant,
  generateMetadata,
  generateViewport,
  getRequestScopedMerchant,
  mockIsValidMerchantIdentifier,
  resetStorefrontLayoutTestState,
} from './layout.test-utils';

describe('storefront layout metadata', () => {
  beforeEach(() => {
    resetStorefrontLayoutTestState();
  });

  it('returns noindex metadata without inherited canonicals when the storefront slug is invalid', async () => {
    mockIsValidMerchantIdentifier.mockReturnValueOnce(false);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'invalid@slug!' }),
    });

    expect(metadata.title).toBe('Store Not Found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
  });

  it('returns noindex metadata without inherited canonicals when the storefront slug is missing', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'products' }),
    });

    expect(metadata.title).toBe('Store Not Found');
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates).toBeNull();
  });

  it('uses the merchant domain as metadataBase and keeps the OgaBassey app banner on Oga routes', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.metadataBase?.toString()).toBe('https://ogabassey.com/');
    expect(metadata.other).toEqual({
      'apple-itunes-app': 'app-id=6472735367',
    });
  });

  it('does not leak the OgaBassey app banner onto generic storefronts', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      business_name: 'Template Test Store',
      slug: 'template-test-store',
      custom_domain: null,
      site_title: 'Template Test Store',
      template_id: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'template-test-store' }),
    });

    expect(metadata.metadataBase?.toString()).toBe(
      'https://template-test-store.usebaci.com/'
    );
    expect(metadata.other).toBeUndefined();
  });

  it('falls back to the slug-based storefront URL when no custom domain exists', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      business_name: 'Test Store',
      slug: 'test-store',
      custom_domain: null,
      site_title: 'Test Store',
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(metadata.metadataBase?.toString()).toBe(
      'https://test-store.usebaci.com/'
    );
  });

  it('leaves route-level alternates to page metadata', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(
      baseMerchant as unknown as Awaited<
        ReturnType<typeof getRequestScopedMerchant>
      >
    );

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(metadata.alternates).toBeUndefined();
  });

  it('reads google verification from published_config when feature settings omit it', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      ...baseMerchant,
      slug: 'test-store',
      custom_domain: null,
      site_title: 'Test Store',
      feature_settings: {},
      published_config: {
        google_site_verification: 'google-verification-token',
      },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(metadata.verification).toEqual({
      google: 'google-verification-token',
    });
  });

  it('keeps the static viewport configuration unchanged', () => {
    expect(generateViewport()).toEqual({
      width: 'device-width',
      initialScale: 1,
    });
  });
});
