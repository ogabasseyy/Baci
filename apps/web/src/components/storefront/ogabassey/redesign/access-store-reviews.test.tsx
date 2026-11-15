import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MerchantData } from '@/hooks/merchant/types';
import { AccessFooterIntro } from './access-footer-intro';
import { AccessStoreReviews } from './access-store-reviews';

afterEach(() => vi.unstubAllGlobals());

describe('connected store reviews', () => {
  it('uses the merchant place ID, preserves attribution and includes lower-rated feedback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rating: 4.6,
        totalReviews: 269,
        attributions: [],
        reviews: [
          {
            authorName: 'A customer',
            authorPhoto: 'https://lh3.googleusercontent.com/customer-photo',
            authorUrl: 'https://www.google.com/maps/contrib/1',
            rating: 3,
            text: 'Delivery could improve.',
            relativeTime: '2 weeks ago',
            timestamp: 100,
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AccessStoreReviews placeId="ChIJ-test" />);
    expect(await screen.findByText('Delivery could improve.')).toBeVisible();
    expect(screen.getByRole('img', { name: 'A customer profile photo' })).toHaveAttribute('src', 'https://lh3.googleusercontent.com/customer-photo');
    expect(screen.getByRole('img', { name: '3 out of 5 stars' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/google-places/reviews?placeId=ChIJ-test',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(screen.getByText(/Most relevant/)).toBeVisible();
  });
  it('keeps an attributed Maps link when the API fails, without inventing ratings', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    render(<AccessStoreReviews placeId="ChIJ-test" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      screen.getByRole('link', { name: 'Read reviews on Google Maps ↗' })
    ).toHaveAttribute(
      'href',
      expect.stringContaining('query_place_id=ChIJ-test')
    );
    expect(screen.queryByText(/\/ 5/)).toBeNull();
  });
  it('does not request reviews when the merchant has not enabled them', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AccessFooterIntro
        basePath="/ogabassey"
        merchant={
          {
            id: 'merchant-id',
user_id: 'owner-id',
business_name: 'Ogabassey',
business_type: 'electronics',
feature_settings: {
              google_reviews_enabled: false,
              google_place_id: 'ChIJ-test',
            },
          } satisfies MerchantData
        }
      />
    );
    expect(
      screen.queryByRole('region', { name: 'Store reviews from Google' })
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: 'Meet your repair team ↗' })
    ).toHaveAttribute('href', '/ogabassey/repairs');
  });
});
