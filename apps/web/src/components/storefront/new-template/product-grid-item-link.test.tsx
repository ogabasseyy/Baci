import { render } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    className,
  }: {
    children?: React.ReactNode;
    href: string;
    prefetch?: boolean;
    className?: string;
  }) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      className={className}
    >
      {children}
    </a>
  ),
}));

import { ProductGridItemLink } from './product-grid-item-link';
import type { Product } from './types';

describe('ProductGridItemLink', () => {
  it('renders a non-prefetching product link with basePath', () => {
    const product = {
      id: 'prod-1',
      name: 'Phone',
      slug: 'phone',
      category: 'Phones',
      categories: { name: 'Phones', slug: 'phones' },
      price: 1000,
    } as unknown as Product;

    const { container } = render(
      <ProductGridItemLink product={product} basePath="/ogabassey" />
    );

    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', '/ogabassey/phones/phone');
    expect(link).toHaveAttribute('data-prefetch', 'false');
    expect(link).toHaveClass('absolute inset-0 z-0');
  });
});
