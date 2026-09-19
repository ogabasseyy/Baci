import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getCachedMerchant } from '@/lib/cached-data';
import { safeJsonLdStringify } from '@/lib/json-ld-script-escape';
import { isValidMerchantIdentifier } from '@/lib/validation';

vi.mock('@/components/storefront/ogabassey/pages/quiz', () => ({
  OgabasseyV2Quiz: ({ merchantSlug }: { merchantSlug: string }) => (
    <div data-testid="quiz-ui">{merchantSlug}</div>
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
}));

vi.mock('@/lib/json-ld-script-escape', () => ({
  safeJsonLdStringify: vi.fn((value: unknown) => JSON.stringify(value)),
}));

vi.mock('@/lib/validation', () => ({
  isDomainIdentifier: vi.fn(() => false),
  isValidMerchantIdentifier: vi.fn(() => true),
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
}));

const { default: QuizPage } = await import('./page');

describe('QuizPage', () => {
  it('renders the Ogabassey web quiz route with structured data', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      slug: 'ogabassey',
      template_id: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    render(await QuizPage({ params: Promise.resolve({ slug: 'ogabassey' }) }));

    expect(screen.getByTestId('quiz-ui')).toHaveTextContent('ogabassey');
    expect(safeJsonLdStringify).toHaveBeenCalledWith(
      expect.objectContaining({
        '@type': 'WebPage',
        name: 'Ogabassey Super Quiz',
      })
    );
  });

  it('returns notFound for invalid or non-Ogabassey stores', async () => {
    vi.mocked(isValidMerchantIdentifier).mockReturnValue(false);

    await expect(
      QuizPage({ params: Promise.resolve({ slug: 'bad!!slug' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    vi.mocked(isValidMerchantIdentifier).mockReturnValue(true);
    vi.mocked(getCachedMerchant).mockResolvedValue({
      slug: 'other',
      template_id: 'default',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    await expect(
      QuizPage({ params: Promise.resolve({ slug: 'other' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
