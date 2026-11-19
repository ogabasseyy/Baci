import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProductIndexCard } from './product-index-card';
import { makeProduct } from './product-index-card.test-fixtures';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // biome-ignore lint/performance/noImgElement: test stub for next/image
    <img alt={alt} src={src} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    'aria-label': label,
  }: {
    children: ReactNode;
    href: string;
    'aria-label'?: string;
  }) => (
    <a href={href} aria-label={label}>
      {children}
    </a>
  ),
}));

describe('ProductIndexCard accessibility semantics', () => {
  it('renders product title as h3 by default and applies aria-posinset and aria-setsize to article', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        posInSet={3}
        product={makeProduct({ name: 'iPhone 13 Pro' })}
        setSize={24}
      />
    );

    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'iPhone 13 Pro',
    });
    expect(heading).toBeInTheDocument();

    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-posinset', '3');
    expect(article).toHaveAttribute('aria-setsize', '24');
  });

  it('supports configurable headingLevel="h2" for contexts without an intervening h2 section', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        headingLevel="h2"
        pathPrefix=""
        product={makeProduct({ name: 'iPhone 13 Pro' })}
      />
    );

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'iPhone 13 Pro',
      })
    ).toBeInTheDocument();
  });
});
