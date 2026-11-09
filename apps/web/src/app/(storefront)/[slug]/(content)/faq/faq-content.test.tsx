import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestScopedMerchant } from '@/lib/cached-data';

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

vi.mock('@/lib/merchant-template-data', () => ({
  toTemplateMerchantData: vi.fn((merchant) => merchant),
}));

vi.mock('@/components/storefront/ogabassey/pages/help-support', () => ({
  OgabasseyV2HelpSupport: vi.fn(() => (
    <div data-testid="ogabassey-help">Ogabassey Help</div>
  )),
}));

vi.mock('../pages/faq/faq-page-client', () => ({
  FAQPageClient: ({ children }: { children?: ReactNode }) => (
    <div data-testid="faq-client">FAQ Client{children}</div>
  ),
}));

vi.mock('../content-page-crawl-summary', () => ({
  ContentPageCrawlSummary: vi.fn(({ kind }: { kind: string }) => (
    <div data-testid="crawl-summary">{kind}</div>
  )),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { FAQContent } = await import('./faq-content');
const { OgabasseyV2HelpSupport } = await import(
  '@/components/storefront/ogabassey/pages/help-support'
);

describe('FAQContent', () => {
  beforeEach(() => {
    vi.mocked(getRequestScopedMerchant).mockReset();
    vi.mocked(OgabasseyV2HelpSupport).mockClear();
    notFound.mockClear();
  });

  it('calls notFound when merchant is null', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue(null);

    await expect(
      FAQContent({ params: Promise.resolve({ slug: 'missing' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('renders Ogabassey template help page with normalized FAQs and crawl summary', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Ogabassey',
      business_type: 'electronics',
      template_id: 'ogabassey',
      slug: 'ogabassey',
      faq_items: [
        { question: 'What is your return policy?', answer: '7 days return' },
      ],
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQContent({
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    render(ui);

    expect(screen.getByTestId('ogabassey-help')).toBeInTheDocument();
    expect(screen.getByTestId('crawl-summary')).toBeInTheDocument();
    expect(OgabasseyV2HelpSupport).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant: expect.objectContaining({
          slug: 'ogabassey',
          faq_items: [
            expect.objectContaining({
              question: 'What is your return policy?',
              answer: expect.stringContaining('14 days'),
            }),
          ],
        }),
      }),
      undefined
    );
  });

  it('renders Ogabassey template help page with empty resolved FAQs when non-Ogabassey merchant has no custom FAQs', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Custom Store',
      business_type: 'fashion',
      template_id: 'ogabassey',
      slug: 'custom-store',
      faq_items: [],
      pages: {},
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQContent({
      params: Promise.resolve({ slug: 'custom-store' }),
    });

    render(ui);

    expect(screen.getByTestId('ogabassey-help')).toBeInTheDocument();
    expect(OgabasseyV2HelpSupport).toHaveBeenCalledWith(
      expect.objectContaining({
        merchant: expect.objectContaining({
          slug: 'custom-store',
          faq_items: [],
        }),
      }),
      undefined
    );
  });

  it('renders standard FAQPageClient fallback with resolved FAQs for non-template merchants', async () => {
    const customFaqs = [
      { question: 'How to pay?', answer: 'Card or transfer' },
    ];
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      business_name: 'Standard Store',
      business_type: 'fashion',
      template_id: null,
      slug: 'standard-store',
      faq_items: customFaqs,
      pages: { faq: 'legacy markdown' },
    } as unknown as Awaited<ReturnType<typeof getRequestScopedMerchant>>);

    const ui = await FAQContent({
      params: Promise.resolve({ slug: 'standard-store' }),
    });

    render(ui);

    expect(screen.getByTestId('faq-client')).toBeInTheDocument();
    expect(screen.getByTestId('crawl-summary')).toBeInTheDocument();
    expect(OgabasseyV2HelpSupport).not.toHaveBeenCalled();
  });
});
