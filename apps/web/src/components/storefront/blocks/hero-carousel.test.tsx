import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('embla-carousel-autoplay', () => ({ default: () => ({}) }));
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/carousel', () => ({
  Carousel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CarouselContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CarouselItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CarouselNext: () => null,
  CarouselPrevious: () => null,
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '/merchant' }),
}));

import { HeroCarousel } from './hero-carousel';

describe('HeroCarousel', () => {
  it('scopes AI-authored root-relative CTA paths to the merchant storefront', () => {
    render(
      <HeroCarousel
        slides={[
          {
            ctaLink: '/products',
            ctaText: 'Shop now',
            image: '/hero.jpg',
            subtitle: 'Current collection',
            title: 'Featured',
          },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'Shop now' })).toHaveAttribute(
      'href',
      '/merchant/products'
    );
  });
});
