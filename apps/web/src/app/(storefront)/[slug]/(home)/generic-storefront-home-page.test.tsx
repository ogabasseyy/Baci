import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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

vi.mock('@/app/(storefront)/storefront-eager-full-css-layout', () => ({
  StorefrontEagerFullCssLayout: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const { GenericStorefrontHomePage } = await import(
  './generic-storefront-home-page'
);

describe('GenericStorefrontHomePage', () => {
  beforeEach(() => {
    mockStorefrontPageContent.mockClear();
  });

  it('eagerly styles generic homepages without putting the sheet on the OgaBassey graph', () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'generic-storefront-home-page.tsx'
      ),
      'utf8'
    );

    expect(source).toContain('StorefrontEagerFullCssLayout');
    expect(source).not.toContain('StorefrontFullStyleLoader');

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
