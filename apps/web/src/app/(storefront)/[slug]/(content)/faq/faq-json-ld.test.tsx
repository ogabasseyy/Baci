import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { generateFAQSchema } from '@/lib/seo-utils';

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock('@/lib/seo-utils', () => ({
  generateFAQSchema: vi.fn((items) => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items,
  })),
}));

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: vi.fn(({ data }: { data: unknown }) => (
    <script data-testid="faq-json-ld" type="application/ld+json">
      {JSON.stringify(data)}
    </script>
  )),
}));

const { FAQJsonLd } = await import('./faq-json-ld');

describe('FAQJsonLd', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(generateFAQSchema).mockClear();
  });

  it('returns null when merchant is null', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(null);

    const ui = await FAQJsonLd({
      params: Promise.resolve({ slug: 'missing' }),
    });

    expect(ui).toBeNull();
  });

  it('returns null when merchant has no FAQs and is not Ogabassey template', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Store',
      template_id: 'default',
      slug: 'store',
      faq_items: [],
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQJsonLd({
      params: Promise.resolve({ slug: 'store' }),
    });

    expect(ui).toBeNull();
    expect(generateFAQSchema).not.toHaveBeenCalled();
  });

  it('returns null when non-Ogabassey merchant uses Ogabassey template with no custom FAQs', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Custom Store',
      template_id: 'ogabassey',
      slug: 'custom-store',
      faq_items: [],
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQJsonLd({
      params: Promise.resolve({ slug: 'custom-store' }),
    });

    expect(ui).toBeNull();
    expect(generateFAQSchema).not.toHaveBeenCalled();
  });

  it('renders JsonLd schema for custom FAQs on regular merchant', async () => {
    const customFaqs = [{ question: 'Shipping?', answer: '1-3 days' }];
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Custom Store',
      template_id: null,
      slug: 'custom-store',
      faq_items: customFaqs,
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQJsonLd({
      params: Promise.resolve({ slug: 'custom-store' }),
    });

    expect(ui).not.toBeNull();
    render(ui);

    expect(screen.getByTestId('faq-json-ld')).toBeInTheDocument();
    expect(generateFAQSchema).toHaveBeenCalledWith(customFaqs);
  });

  it('normalizes return and warranty answers in schema for Ogabassey merchant', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Ogabassey',
      template_id: 'ogabassey',
      slug: 'ogabassey',
      faq_items: [
        { question: 'What is your return policy?', answer: '7 days return' },
        {
          question: 'How does the warranty work?',
          answer: '3 months warranty',
        },
      ],
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQJsonLd({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(ui).not.toBeNull();
    render(ui);

    expect(generateFAQSchema).toHaveBeenCalledWith([
      expect.objectContaining({
        question: 'What is your return policy?',
        answer: expect.stringContaining('14 days'),
      }),
      expect.objectContaining({
        question: 'How does the warranty work?',
        answer: expect.stringContaining('one-year'),
      }),
    ]);
  });

  it('generates normalized schema for Ogabassey fallback FAQs when merchant has no custom FAQs', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Ogabassey',
      template_id: 'ogabassey',
      slug: 'ogabassey',
      faq_items: [],
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQJsonLd({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(ui).not.toBeNull();
    render(ui);

    expect(generateFAQSchema).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          question: 'What is your return policy?',
          answer: expect.stringContaining('14 days'),
        }),
      ])
    );
  });
});
