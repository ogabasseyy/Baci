import { render, screen } from '@testing-library/react';
import { use } from 'react';
import { describe, expect, it, vi } from 'vitest';

const {
  mockCriticalHomeCssImport,
  mockOgabasseyStaticHomePageContent,
  mockOgabasseyStaticResourceHints,
} = vi.hoisted(() => ({
  mockCriticalHomeCssImport: vi.fn(),
  mockOgabasseyStaticHomePageContent: vi.fn(
    ({ pathPrefix }: { pathPrefix: string }) => (
      <main>OgaBassey static home {pathPrefix}</main>
    )
  ),
  mockOgabasseyStaticResourceHints: vi.fn(() => (
    <span data-testid="ogabassey-static-resource-hints" />
  )),
}));

vi.mock('@/app/(storefront)/storefront-home-critical.css', () => {
  mockCriticalHomeCssImport();
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

const { OgabasseyStaticHomePage } = await import(
  './ogabassey-static-home-page'
);

describe('OgabasseyStaticHomePage', () => {
  it('does not statically import homepage critical CSS onto first paint', () => {
    expect(mockCriticalHomeCssImport).not.toHaveBeenCalled();
  });

  it('renders the static resource hints and path-prefixed home shell', () => {
    render(<OgabasseyStaticHomePage pathPrefix="/ogabassey" />);

    expect(mockOgabasseyStaticResourceHints).toHaveBeenCalledOnce();
    expect(mockOgabasseyStaticHomePageContent).toHaveBeenCalledWith({
      omitCommittedHero: true,
      pathPrefix: '/ogabassey',
    });
    expect(
      screen.getByText('OgaBassey static home /ogabassey')
    ).toBeInTheDocument();
  });

  it('reserves hero geometry while the async content suspends', () => {
    // The content awaits the hero-shell lookup before it returns its own
    // inner Suspense; without this outer boundary the route's
    // fallback={null} would reserve nothing on a cold/slow lookup and the
    // streamed hero would shift layout.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
    mockOgabasseyStaticHomePageContent.mockImplementationOnce(() => {
      // Suspend on every render attempt (a one-time thrown promise lets
      // React's render retry commit the default instead of the fallback).
      use(new Promise<never>(() => {}));
      // Unreachable: the hook above suspends on every render attempt.
      return <div />;
    });
    render(<OgabasseyStaticHomePage pathPrefix="/ogabassey" />);

    expect(
      document.querySelector(
        '[data-ogabassey-home-hero-reserve-fallback="true"]'
      )
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
