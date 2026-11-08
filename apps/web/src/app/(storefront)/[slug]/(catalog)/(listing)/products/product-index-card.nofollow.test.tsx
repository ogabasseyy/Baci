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
    rel,
    'aria-label': label,
  }: {
    children: ReactNode;
    href: string;
    rel?: string;
    'aria-label'?: string;
  }) => (
    <a href={href} rel={rel} aria-label={label}>
      {children}
    </a>
  ),
}));

describe('ProductIndexCard search match rel="nofollow"', () => {
  it('appends rel="nofollow" and query params when search matches are present', () => {
    render(
      <ProductIndexCard
        modern
        formattedPrice="₦200,000"
        pathPrefix=""
        product={makeProduct({
          searchMatch: {
            productId: 'product-1',
            total: 1,
            price: 200000,
            condition: 'used',
          },
        })}
      />
    );

    const link = screen.getByRole('link', {
      name: 'Choose iPhone 13 Pro to buy',
    });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('match_base=1')
    );
    expect(link).toHaveAttribute('rel', 'nofollow');
  });

  it('omits rel="nofollow" when no search match query params are appended', () => {
    render(
      <ProductIndexCard
        modern
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct()}
      />
    );

    const link = screen.getByRole('link', {
      name: 'Choose iPhone 13 Pro to buy',
    });
    expect(link).not.toHaveAttribute('rel');
  });
});
