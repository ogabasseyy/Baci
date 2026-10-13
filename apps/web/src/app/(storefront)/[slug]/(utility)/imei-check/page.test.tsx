import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImeiCheckerHero } from '@/components/storefront/ogabassey/pages/imei-checker-hero';
import { getCachedMerchant } from '@/lib/cached-data';

vi.mock('@/components/storefront/ogabassey/pages/imei-checker', () => ({
  OgabasseyImeiChecker: ({ omitHero }: { omitHero?: boolean }) => (
    <div>
      {omitHero ? null : <h1>Don't Get Scammed.</h1>}
      <div>IMEI checker UI</div>
    </div>
  ),
}));

vi.mock('@/lib/cached-data', () => ({
  getCachedMerchant: vi.fn(),
  getCachedMerchantByDomain: vi.fn(async () => null),
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

const {
  default: ImeiCheckPage,
  generateStaticParams,
  ImeiCheckResolvedContent,
  metadata,
} = await import('./page');

describe('ImeiCheckPage', () => {
  beforeEach(() => {
    vi.mocked(getCachedMerchant).mockReset();
    notFound.mockClear();
  });

  it('prerenders both OgaBassey host identifiers so the IMEI hero can land in the static shell', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('paints IMEI LCP copy without awaiting params', () => {
    const then = vi.fn(() => {
      throw new Error('params read outside boundary');
    });
    const params = { then } as unknown as Promise<{ slug: string }>;
    const ui = ImeiCheckPage({ params });

    expect(ui.props.children[0].type).toBe(ImeiCheckerHero);
    expect(then).not.toHaveBeenCalled();
    expect(screen.queryByText('IMEI checker UI')).not.toBeInTheDocument();
  });
  it('renders IMEI UI with crawler-visible verification guidance', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'ogabassey',
      slug: 'ogabassey',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    render(
      await ImeiCheckResolvedContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(screen.getByText('IMEI checker UI')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'What to confirm before running an IMEI check',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/network status, carrier locks/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/NGN 500,000/)).toBeInTheDocument();
  });

  it('omits in-content IMEI copy because the page already committed the LCP hero', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'ogabassey',
      slug: 'other-ogabassey-store',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    render(
      await ImeiCheckResolvedContent({
        params: Promise.resolve({ slug: 'other-ogabassey-store' }),
      })
    );

    expect(
      screen.queryByRole('heading', { name: /Don't Get Scammed/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText('IMEI checker UI')).toBeInTheDocument();
  });

  it('uses a verification-focused meta description', () => {
    expect(metadata.description).toContain('device identity');
  });

  it('uses an absolute title so the platform suffix cannot leak onto the storefront', () => {
    expect(metadata.title).toEqual({ absolute: 'IMEI Check' });
  });

  it('throws notFound for non-ogabassey templates', async () => {
    vi.mocked(getCachedMerchant).mockResolvedValue({
      template_id: 'default',
      slug: 'demo-store',
    } as unknown as Awaited<ReturnType<typeof getCachedMerchant>>);

    await expect(
      ImeiCheckResolvedContent({
        params: Promise.resolve({ slug: 'demo-store' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('keeps the IMEI checker UI off the route module graph', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
      'utf8'
    );

    expect(source).toContain("await import('./imei-check-page-content')");
    expect(source).not.toMatch(
      /import\s+\{[^}]*ImeiCheckPageContent[^}]*\}\s+from\s+['"]\.\/imei-check-page-content['"]/
    );
  });
});
