import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));

import type { LaunchProductSlide } from './LaunchCarousel';
import { ProductSlideBody } from './product-slide-body';

const PRODUCT: LaunchProductSlide = {
  kind: 'product',
  id: 'p1',
  name: 'Galaxy A27 5G',
  priceLabel: '₦50,000',
  href: '/ogabassey/smartphones/a27',
  imageUrl: 'https://cdn.ogabassey.com/a27.avif',
  imageAlt: 'Galaxy A27 5G — Samsung',
  ctaLabel: 'Pre-order now',
};

describe('ProductSlideBody', () => {
  it('renders the name, price, CTA and a lazy, descriptive image', () => {
    render(<ProductSlideBody slide={PRODUCT} />);

    expect(screen.getByText('Galaxy A27 5G')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Galaxy A27 5G' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('₦50,000')).toBeInTheDocument();
    expect(screen.getByText('Pre-order now')).toBeInTheDocument();

    const image = screen.getByRole('img', { name: 'Galaxy A27 5G — Samsung' });
    expect(image).toHaveAttribute('src', 'https://cdn.ogabassey.com/a27.avif');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('fetchpriority', 'low');
    // Desktop slot is ~40% of the container, not a 320px cap.
    expect(image).toHaveAttribute('sizes', '(min-width: 1400px) 560px, 40vw');
  });

  it('eager/high-priorities the image when marked as priority (LCP candidate)', () => {
    render(<ProductSlideBody priority slide={PRODUCT} />);

    const image = screen.getByRole('img', { name: 'Galaxy A27 5G — Samsung' });
    expect(image).toHaveAttribute('loading', 'eager');
    expect(image).toHaveAttribute('fetchpriority', 'high');
  });
});
