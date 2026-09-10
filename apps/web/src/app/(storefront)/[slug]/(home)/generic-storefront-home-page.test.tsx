import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStorefrontPageContent, mockEagerLayout } = vi.hoisted(() => ({
  mockStorefrontPageContent: vi.fn(
    (_props: { params: Promise<{ slug: string }> }) => (
      <main>Shared storefront page content</main>
    )
  ),
  mockEagerLayout: vi.fn(({ children }: { children: ReactNode }) => (
    <div data-testid="eager-css">{children}</div>
  )),
}));

vi.mock('../storefront-page-content', () => ({
  StorefrontPageContent: (props: { params: Promise<{ slug: string }> }) =>
    mockStorefrontPageContent(props),
}));

vi.mock('@/app/(storefront)/storefront-eager-full-css-layout', () => ({
  StorefrontEagerFullCssLayout: (props: { children: ReactNode }) =>
    mockEagerLayout(props),
}));

const { GenericStorefrontHomePage } = await import(
  './generic-storefront-home-page'
);

describe('GenericStorefrontHomePage', () => {
  beforeEach(() => {
    mockEagerLayout.mockClear();
    mockStorefrontPageContent.mockClear();
  });

  it('eagerly imports storefront CSS for generic merchant homes', () => {
    render(
      <GenericStorefrontHomePage
        params={Promise.resolve({ slug: 'another-shop' })}
      />
    );

    expect(mockEagerLayout).toHaveBeenCalledOnce();
    expect(screen.getByTestId('eager-css')).toBeInTheDocument();
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
