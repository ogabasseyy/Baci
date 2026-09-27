import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OgabasseyHomeRecoveryHero } from './ogabassey-home-recovery-hero';

vi.mock('@/components/storefront/ogabassey/components/Hero', () => ({
  Hero: ({
    omitDocumentHeading,
    omitMobileCarousel,
    prioritizeMobileHeroImage,
    slides,
  }: {
    omitDocumentHeading: boolean;
    omitMobileCarousel: boolean;
    prioritizeMobileHeroImage: boolean;
    slides: Array<{ href: string }>;
  }) => (
    <section
      aria-label="Recovered hero and utilities"
      data-omit-heading={String(omitDocumentHeading)}
      data-omit-mobile-carousel={String(omitMobileCarousel)}
      data-priority={String(prioritizeMobileHeroImage)}
      data-slide-href={slides[0]?.href ?? ''}
    />
  ),
}));

it('restores the hero independently from below-fold catalog data after the shell budget expires', async () => {
  render(
    await OgabasseyHomeRecoveryHero({
      productsPromise: Promise.resolve([]),
      merchant: {
        id: 'verified-merchant',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
        country: 'NG',
        payout_currency: 'NGN',
      },
    })
  );
  const hero = screen.getByRole('region', {
    name: 'Recovered hero and utilities',
  });
  expect(hero).toHaveAttribute('data-omit-heading', 'true');
  expect(hero).toHaveAttribute('data-priority', 'true');
});

it('forwards omitMobileCarousel through recovery when the shell has no slides', async () => {
  render(
    await OgabasseyHomeRecoveryHero({
      omitMobileCarousel: true,
      productsPromise: Promise.resolve([]),
      merchant: {
        id: 'verified-merchant',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
        country: 'NG',
        payout_currency: 'NGN',
      },
    })
  );

  expect(
    screen.getByRole('region', { name: 'Recovered hero and utilities' })
  ).toHaveAttribute('data-omit-mobile-carousel', 'true');
});

it('uses the resolved custom domain for recovered product slide URLs', async () => {
  render(
    await OgabasseyHomeRecoveryHero({
      productsPromise: Promise.resolve([
        {
          id: 'product-1',
          name: 'Samsung Galaxy A27',
          slug: 'samsung-galaxy-a27',
          price: '₦250,000',
          image: 'https://cdn.ogabassey.com/products/a27.avif',
          description: '',
          category: 'Smartphones',
          categorySlug: 'smartphones',
          brand: 'Samsung',
        },
      ]),
      merchant: {
        id: 'verified-merchant',
        slug: 'ogabassey',
        custom_domain: 'shop.example.com',
        country: 'NG',
        payout_currency: 'NGN',
      },
    })
  );

  expect(
    screen.getByRole('region', { name: 'Recovered hero and utilities' })
  ).toHaveAttribute(
    'data-slide-href',
    'https://shop.example.com/smartphones/samsung-galaxy-a27'
  );
});
