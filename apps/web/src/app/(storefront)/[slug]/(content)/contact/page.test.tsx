import { render } from '@testing-library/react';
import { headers } from 'next/headers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMerchantByIdentifier } from '@/lib/cached-data';

const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
const mockConnection = vi.hoisted(() => vi.fn());

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: vi.fn(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock('@/templates/registry', () => ({
  getTemplate: vi.fn(() => null),
}));

vi.mock('../pages/contact/contact-page-client', () => ({
  ContactPageClient: vi.fn(() => null),
}));

const { ContactPageContent } = await import('./contact-page-content');
const { generateMetadata } = await import('./page');

const merchantFixture = {
  business_name: 'Test Store',
  logo_url: 'https://cdn.example.com/logo.png',
  slug: 'test-store',
  custom_domain: null,
  support_email: 'support@test.example',
  support_phone: '+2348000000000',
  phone: '+2348111111111',
  email: 'hello@test.example',
  country: 'NG',
  pages: {
    contact: 'Contact copy',
  },
  social_media: {
    instagram: '@teststore',
    twitter: '@teststore',
  },
  trust_profile: {
    founded_year: 2020,
    return_policy: {
      summary: 'Returns accepted for 7 days.',
      window_days: 7,
      return_method: 'mail',
      return_fees: 'free',
    },
    customer_service: {
      whatsapp_number: '+2349000000000',
    },
  },
};

describe('contact metadata', () => {
  beforeEach(() => {
    vi.mocked(getMerchantByIdentifier).mockReset();
    vi.mocked(headers).mockReset();
    vi.mocked(headers).mockResolvedValue(new Headers());
    mockNotFound.mockClear();
    mockConnection.mockReset();
  });

  it('returns fallback title when merchant is missing', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'unknown' }),
    });

    expect(metadata.title).toBe('Contact Us');
  });

  it('prefers the request-scoped custom domain for canonical metadata', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      business_name: 'Test Store',
      logo_url: null,
      slug: 'test-store',
      custom_domain: 'ogabassey.com',
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/contact'
    );
    expect(metadata.openGraph?.url).toBe('https://ogabassey.com/contact');
  });

  it('uses trust profile support contact data in JSON-LD', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers([['x-custom-domain', 'ogabassey.com']])
    );
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(
      merchantFixture as unknown as Awaited<
        ReturnType<typeof getMerchantByIdentifier>
      >
    );

    const ui = await ContactPageContent({
      params: Promise.resolve({ slug: 'test-store' }),
    });
    render(ui);

    const schemaScript = document.querySelector(
      'script[type="application/ld+json"]'
    );
    expect(schemaScript).not.toBeNull();

    const schema = JSON.parse(schemaScript?.textContent || '{}') as {
      mainEntity: Record<string, unknown>;
    };

    expect(schema.mainEntity).toMatchObject({
      email: 'support@test.example',
      telephone: '+2348000000000',
      contactPoint: {
        email: 'support@test.example',
        telephone: '+2348000000000',
      },
      foundingDate: '2020',
    });
    expect(schema.mainEntity.sameAs).toEqual(
      expect.arrayContaining([
        'https://instagram.com/teststore',
        'https://x.com/teststore',
      ])
    );
    expect(schema.mainEntity.hasMerchantReturnPolicy).toMatchObject({
      merchantReturnDays: 7,
      returnPolicyCountry: 'NG',
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/FreeReturn',
    });
  });

  it('throws not found when the merchant is missing at render time', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue(null);

    await expect(
      ContactPageContent({
        params: Promise.resolve({ slug: 'missing-store' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('throws not found when contact data is whitespace only', async () => {
    vi.mocked(getMerchantByIdentifier).mockResolvedValue({
      ...merchantFixture,
      email: '   ',
      phone: '   ',
      support_email: '   ',
      support_phone: '   ',
      pages: {
        contact: '   ',
      },
      trust_profile: {},
    } as unknown as Awaited<ReturnType<typeof getMerchantByIdentifier>>);

    await expect(
      ContactPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });
});
