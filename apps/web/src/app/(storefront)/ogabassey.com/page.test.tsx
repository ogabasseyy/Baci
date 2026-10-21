import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  merchant: vi.fn(),
  shell: vi.fn(),
  frame: vi.fn(),
  baseMetadata: vi.fn(),
  homeMetadata: vi.fn(),
}));
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: mocks.merchant,
}));
vi.mock('../ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: mocks.shell,
}));
vi.mock('../[slug]/layout', () => ({
  StorefrontLayoutContent: mocks.frame,
  generateMetadata: mocks.baseMetadata,
  generateViewport: () => ({ width: 'device-width' }),
}));
vi.mock('../[slug]/(home)/page', () => ({
  generateMetadata: mocks.homeMetadata,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('../ogabassey/ogabassey-home-page-content', () => ({
  PublishedOgabasseyHomePageContent: ({
    shellSlides,
  }: {
    shellSlides: Array<{ name: string }> | null;
  }) => (
    <section>
      {shellSlides?.map((s) => (
        <h2 key={s.name}>{s.name}</h2>
      ))}
    </section>
  ),
}));
vi.mock('../ogabassey/ogabassey-home-hero-preload-link', () => ({
  OgabasseyHomeHeroPreloadLink: ({ src }: { src: string }) => (
    <link rel="preload" as="image" href={src} />
  ),
}));
vi.mock('../ogabassey/ogabassey-home-static-shell-head', () => ({
  OgabasseyHomeStaticShellHead: () => null,
}));
vi.mock('../ogabassey/ogabassey-home-critical-shell', () => ({
  OgabasseyHomeCriticalShell: () => null,
}));
vi.mock('../ogabassey/ogabassey-static-resource-hints', () => ({
  OgabasseyStaticResourceHints: () => null,
}));
vi.mock('@/components/storefront/ad-attribution-capture', () => ({
  AdAttributionCapture: () => null,
}));

describe('canonical homepage resolved-data delivery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    document
      .querySelectorAll('link[rel="preload"][as="image"]')
      .forEach((n) => {
        n.remove();
      });
    mocks.merchant.mockResolvedValue({ id: 'merchant-a', is_published: true });
    mocks.shell.mockResolvedValue({
      status: 'published',
      merchantId: 'merchant-a',
      slides: [
        {
          name: 'Authorized phone',
          imageUrl: 'https://cdn.example/phone.avif',
        },
      ],
    });
    mocks.frame.mockImplementation(
      async ({ children }: { children: ReactNode }) => <main>{children}</main>
    );
  });

  it('passes the resolved authorized slides directly to the first home frame', async () => {
    const { default: Page } = await import('./page');
    render(await Page());
    expect(
      screen.getByRole('heading', { name: 'Authorized phone' })
    ).toBeInTheDocument();
    expect(
      document.querySelector('link[rel="preload"][as="image"]')
    ).toHaveAttribute('href', 'https://cdn.example/phone.avif');
    expect(mocks.merchant).toHaveBeenCalledWith('ogabassey.com');
  });

  it.each([
    [
      'foreign tenant',
      {
        status: 'published',
        merchantId: 'merchant-b',
        slides: [
          {
            name: 'Private foreign phone',
            imageUrl: 'https://cdn.example/foreign.avif',
          },
        ],
      },
    ],
    ['unpublished shell', { status: 'unpublished' }],
    ['failed lookup', null],
  ])('omits shopping data and hints for %s', async (_label, shell) => {
    mocks.shell.mockResolvedValue(shell);
    const { default: Page } = await import('./page');
    render(await Page());
    expect(screen.queryByRole('heading')).toBeNull();
    expect(
      document.querySelector('link[rel="preload"][as="image"]')
    ).toBeNull();
  });

  it('never emits shopping data or image hints for an unpublished merchant', async () => {
    mocks.merchant.mockResolvedValue({ id: 'merchant-a', is_published: false });
    mocks.frame.mockResolvedValue(<p>Store unpublished</p>);
    const { default: Page } = await import('./page');
    render(await Page());
    expect(screen.getByText('Store unpublished')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(
      document.querySelector('link[rel="preload"][as="image"]')
    ).toBeNull();
  });

  it('preserves not-found and shared shell guard failures', async () => {
    const { default: Page } = await import('./page');
    mocks.merchant.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.frame).not.toHaveBeenCalled();
    mocks.merchant.mockResolvedValue({ id: 'merchant-a', is_published: true });
    mocks.frame.mockRejectedValue(new Error('shared guard failed'));
    await expect(Page()).rejects.toThrow('shared guard failed');
  });

  it('retains inherited verification with canonical homepage metadata', async () => {
    mocks.baseMetadata.mockResolvedValue({
      verification: { google: 'verification' },
      manifest: null,
    });
    mocks.homeMetadata.mockResolvedValue({
      title: 'Home',
      robots: { index: true },
    });
    const { generateMetadata } = await import('./page');
    expect(await generateMetadata()).toEqual({
      verification: { google: 'verification' },
      manifest: null,
      title: 'Home',
      robots: { index: true },
    });
  });
});
