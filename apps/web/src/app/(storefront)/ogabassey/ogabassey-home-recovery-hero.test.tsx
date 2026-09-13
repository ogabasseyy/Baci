import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OgabasseyHomeRecoveryHero } from './ogabassey-home-recovery-hero';

vi.mock('@/components/storefront/ogabassey/components/Hero', () => ({
  Hero: ({
    omitDocumentHeading,
    prioritizeMobileHeroImage,
  }: {
    omitDocumentHeading: boolean;
    prioritizeMobileHeroImage: boolean;
  }) => (
    <section
      aria-label="Recovered hero and utilities"
      data-omit-heading={String(omitDocumentHeading)}
      data-priority={String(prioritizeMobileHeroImage)}
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
