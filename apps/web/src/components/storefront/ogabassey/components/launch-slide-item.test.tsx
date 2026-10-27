import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => <a href={href}>{children}</a>,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));
vi.mock('@/lib/routes', () => ({ asRoute: (p: string) => p }));

import type { LaunchSlide } from './LaunchCarousel';
import { LaunchSlideItem } from './launch-slide-item';

const PRODUCT: LaunchSlide = {
  kind: 'product',
  id: 'p1',
  name: 'Galaxy A27 5G',
  priceLabel: '₦50,000',
  href: '/ogabassey/smartphones/a27',
  imageUrl: 'https://cdn.ogabassey.com/a27.avif',
  imageAlt: 'Galaxy A27 5G',
  ctaLabel: 'Pre-order now',
};

describe('LaunchSlideItem', () => {
  it('renders a product slide with a crawlable full-bleed PDP link', () => {
    render(
      <LaunchSlideItem
        index={0}
        isCurrent={true}
        prioritizeImage={true}
        slide={PRODUCT}
      />
    );

    expect(screen.getByText('Galaxy A27 5G')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Galaxy A27 5G' })
    ).not.toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: 'Galaxy A27 5G — Pre-order now',
    });
    expect(link).toHaveAttribute('href', '/ogabassey/smartphones/a27');
    expect(link).toHaveTextContent('Galaxy A27 5G — Pre-order now');
    expect(
      screen.getByRole('img', { name: 'Galaxy A27 5G' })
    ).toHaveAttribute('loading', 'eager');
  });

  it('renders an ad slide with no link', () => {
    const ad: LaunchSlide = {
      kind: 'ad',
      id: 'ad1',
      content: <div>Sponsored</div>,
    };

    render(
      <LaunchSlideItem
        index={1}
        isCurrent={true}
        prioritizeImage={false}
        slide={ad}
      />
    );

    expect(screen.getByText('Sponsored')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('marks an inactive slide inert and aria-hidden', () => {
    const { container } = render(
      <LaunchSlideItem
        index={2}
        isCurrent={false}
        prioritizeImage={false}
        slide={PRODUCT}
      />
    );

    const slide = container.querySelector('[aria-roledescription="slide"]');
    expect(slide).toHaveAttribute('aria-hidden', 'true');
    expect(slide).toHaveAttribute('inert');
  });
});
