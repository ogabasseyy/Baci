import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MerchantData } from '@/hooks/merchant/types';
import { AccessFooterIntro } from './access-footer-intro';

vi.mock('./access-store-reviews', () => ({
  AccessStoreReviews: ({ placeId }: { placeId: string }) => (
    <section aria-label="Google business reviews">{placeId}</section>
  ),
}));

describe('AccessFooterIntro', () => {
  it('keeps the repair journey merchant-scoped without requiring reviews', () => {
    render(<AccessFooterIntro basePath="/ogabassey" />);
    expect(
      screen.getByRole('link', { name: /Meet your repair team/ })
    ).toHaveAttribute('href', '/ogabassey/repairs');
    expect(screen.getByText(/Digital receipts/)).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Google business reviews' })
    ).not.toBeInTheDocument();
  });

  it.each([
    [true, 'public-place', true],
    [false, 'public-place', false],
    [true, '', false],
    [true, '   ', false],
    ['true', 'public-place', false],
  ])('gates reviews on explicit feature configuration (%s, %s)', (enabled, placeId, visible) => {
    const merchant = {
      id: 'merchant-id',
user_id: 'owner-id',
business_name: 'Ogabassey',
business_type: 'electronics',
feature_settings: {
        google_reviews_enabled: enabled,
        google_place_id: placeId,
      },
    } satisfies MerchantData;
    render(<AccessFooterIntro merchant={merchant} basePath="" />);
    expect(
      Boolean(screen.queryByRole('region', { name: 'Google business reviews' }))
    ).toBe(visible);
  });
});
