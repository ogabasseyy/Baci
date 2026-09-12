import { render, screen, waitFor } from '@testing-library/react';
import { Fragment, type ReactNode, Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCriticalHomeCssImport,
  mockFullStorefrontCssImport,
  mockOgabasseyStaticHomePageContent,
  mockOgabasseyStaticResourceHints,
  mockStorefrontPageContent,
} = vi.hoisted(() => ({
  mockCriticalHomeCssImport: vi.fn(),
  mockFullStorefrontCssImport: vi.fn(),
  mockOgabasseyStaticHomePageContent: vi.fn(
    ({ pathPrefix }: { pathPrefix: string }) => (
      <main>OgaBassey static home {pathPrefix || 'root'}</main>
    )
  ),
  mockOgabasseyStaticResourceHints: vi.fn(() => (
    <span data-testid="ogabassey-static-resource-hints" />
  )),
  mockStorefrontPageContent: vi.fn(() => (
    <main>Shared storefront page content</main>
  )),
}));

vi.mock('@/app/(storefront)/storefront-home-critical.css', () => {
  mockCriticalHomeCssImport();
  return {};
});

vi.mock('@/app/(storefront)/storefront-core.css', () => ({}));

vi.mock('@/app/(storefront)/storefront-full.css', () => {
  mockFullStorefrontCssImport();
  return {};
});

vi.mock(
  '@/app/(storefront)/ogabassey/ogabassey-static-home-page-content',
  () => ({
    OgabasseyStaticHomePageContent: (props: {
      omitCommittedHero?: boolean;
      pathPrefix: string;
    }) => mockOgabasseyStaticHomePageContent(props),
  })
);

vi.mock('@/app/(storefront)/ogabassey/ogabassey-static-resource-hints', () => ({
  OgabasseyStaticResourceHints: () => mockOgabasseyStaticResourceHints(),
}));

vi.mock('../storefront-page-content', () => ({
  StorefrontPageContent: () => mockStorefrontPageContent(),
}));

vi.mock('./ogabassey-home-committed-lcp', () => ({
  OgabasseyHomeCommittedLcp: () => (
    <div data-testid="ogabassey-home-committed-lcp" />
  ),
}));

async function renderStorefrontPage(slug: string) {
  const { default: StorefrontPage } = await import('./page');
  const ui = StorefrontPage({
    params: Promise.resolve({ slug }),
  });
  const routeElement = ui.props.children[1].props.children as {
    type: (props: { params: Promise<{ slug: string }> }) => Promise<unknown>;
    props: { params: Promise<{ slug: string }> };
  };

  render((await routeElement.type(routeElement.props)) as ReactNode);
}

describe('OgaBassey dynamic homepage routing', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCriticalHomeCssImport.mockClear();
    mockFullStorefrontCssImport.mockClear();
    mockOgabasseyStaticHomePageContent.mockClear();
    mockOgabasseyStaticResourceHints.mockClear();
    mockStorefrontPageContent.mockClear();
  });

  it('prerenders both OgaBassey home identifiers', async () => {
    const { generateStaticParams } = await import('./page');
    const params = generateStaticParams();

    expect(params).toEqual([{ slug: 'ogabassey.com' }, { slug: 'ogabassey' }]);
  });

  it('keeps route-specific stylesheets out of the shared route import', async () => {
    await import('./page');

    expect(mockCriticalHomeCssImport).not.toHaveBeenCalled();
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();
  });

  it('renders other storefronts through the shared page content path without eager full storefront CSS', async () => {
    await renderStorefrontPage('another-shop');

    expect(mockCriticalHomeCssImport).not.toHaveBeenCalled();
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText('Shared storefront page content')
      ).toBeInTheDocument();
    });
  });

  it('renders the path homepage with the OgaBassey static shell', async () => {
    await renderStorefrontPage('ogabassey');

    await waitFor(() => {
      expect(mockOgabasseyStaticHomePageContent).toHaveBeenCalledWith({
        omitCommittedHero: true,
        pathPrefix: '/ogabassey',
      });
    });
    expect(mockCriticalHomeCssImport).not.toHaveBeenCalled();
    expect(mockFullStorefrontCssImport).not.toHaveBeenCalled();
    expect(mockOgabasseyStaticResourceHints).toHaveBeenCalledOnce();
    expect(
      screen.getByText('OgaBassey static home /ogabassey')
    ).toBeInTheDocument();
    expect(mockStorefrontPageContent).not.toHaveBeenCalled();
  });

  it('renders the custom-domain local homepage with root-relative links', async () => {
    await renderStorefrontPage('ogabassey.com');

    await waitFor(() => {
      expect(mockOgabasseyStaticHomePageContent).toHaveBeenCalledWith({
        omitCommittedHero: true,
        pathPrefix: '',
      });
    });
    expect(screen.getByText('OgaBassey static home root')).toBeInTheDocument();
  });

  it('does not await params in the page — children behind Suspense do', async () => {
    const { default: StorefrontPage } = await import('./page');
    const { OgabasseyHomeCommittedLcp } = await import(
      './ogabassey-home-committed-lcp'
    );
    const then = vi.fn(() => {
      throw new Error('request read outside boundary');
    });
    const params = { then } as unknown as Promise<{ slug: string }>;
    const ui = StorefrontPage({ params });
    const [committedLcp, routeBoundary] = ui.props.children;

    expect(ui.type).toBe(Fragment);
    expect(committedLcp.type).toBe(OgabasseyHomeCommittedLcp);
    expect(routeBoundary.type).toBe(Suspense);
    expect(routeBoundary.props.fallback).toBeNull();
    expect(then).not.toHaveBeenCalled();
  });
});
