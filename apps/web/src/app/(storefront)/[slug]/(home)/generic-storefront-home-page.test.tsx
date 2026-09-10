import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStorefrontPageContent, mockStyleLoader } = vi.hoisted(() => ({
  mockStorefrontPageContent: vi.fn(
    (_props: { params: Promise<{ slug: string }> }) => (
      <main>Shared storefront page content</main>
    )
  ),
  mockStyleLoader: vi.fn(() => null),
}));

vi.mock('../storefront-page-content', () => ({
  StorefrontPageContent: (props: { params: Promise<{ slug: string }> }) =>
    mockStorefrontPageContent(props),
}));

vi.mock('@/app/(storefront)/storefront-full-style-loader', () => ({
  StorefrontFullStyleLoader: () => mockStyleLoader(),
}));

const { GenericStorefrontHomePage } = await import(
  './generic-storefront-home-page'
);

describe('GenericStorefrontHomePage', () => {
  beforeEach(() => {
    mockStyleLoader.mockClear();
    mockStorefrontPageContent.mockClear();
  });

  it('defers the broad storefront stylesheet instead of render-blocking it', () => {
    render(
      <GenericStorefrontHomePage
        params={Promise.resolve({ slug: 'another-shop' })}
      />
    );

    expect(mockStyleLoader).toHaveBeenCalledOnce();
  });

  it('forwards the tracked route params promise to the shared page content', () => {
    const params = Promise.resolve({ slug: 'another-shop' });

    render(<GenericStorefrontHomePage params={params} />);

    expect(
      screen.getByText('Shared storefront page content')
    ).toBeInTheDocument();
    expect(mockStorefrontPageContent).toHaveBeenCalledWith({ params });
  });
});
