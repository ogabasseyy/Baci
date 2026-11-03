import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProductIndexCard } from './product-index-card';
import { makeProduct } from './product-index-card.test-fixtures';

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    loading,
    fetchPriority,
  }: {
    alt: string;
    src: string;
    loading?: 'eager' | 'lazy';
    fetchPriority?: 'high' | 'auto';
  }) => (
    // biome-ignore lint/performance/noImgElement: test stub for next/image
    <img alt={alt} src={src} loading={loading} fetchPriority={fetchPriority} />
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

describe('ProductIndexCard imagePriority', () => {
  it('does not defer the explicitly selected first-screen image', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct()}
        imagePriority={true}
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'eager');
    expect(screen.getByRole('img')).toHaveAttribute('fetchpriority', 'high');
  });

  it('keeps ordinary cards lazy rather than competing with first-screen images', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct()}
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('img')).toHaveAttribute('fetchpriority', 'auto');
  });
});
