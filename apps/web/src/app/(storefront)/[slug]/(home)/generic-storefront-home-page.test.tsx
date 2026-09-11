import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStorefrontPageContent } = vi.hoisted(() => ({
  mockStorefrontPageContent: vi.fn(
    (_props: { params: Promise<{ slug: string }> }) => (
      <main>Shared storefront page content</main>
    )
  ),
}));

vi.mock('../storefront-page-content', () => ({
  StorefrontPageContent: (props: { params: Promise<{ slug: string }> }) =>
    mockStorefrontPageContent(props),
}));

vi.mock('@/app/(storefront)/storefront-full-style-loader', () => ({
  StorefrontFullStyleLoader: () => null,
}));

const { GenericStorefrontHomePage } = await import(
  './generic-storefront-home-page'
);

describe('GenericStorefrontHomePage', () => {
  beforeEach(() => {
    mockStorefrontPageContent.mockClear();
  });

  it('defers storefront CSS instead of eagerly importing the 331KB sheet', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'generic-storefront-home-page.tsx'
      ),
      'utf8'
    );

    expect(source).toContain('StorefrontFullStyleLoader');
    expect(source).not.toContain('StorefrontEagerFullCssLayout');

    render(
      <GenericStorefrontHomePage
        params={Promise.resolve({ slug: 'another-shop' })}
      />
    );

    expect(
      screen.getByText('Shared storefront page content')
    ).toBeInTheDocument();
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
