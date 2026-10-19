// biome-ignore-all assist/source/organizeImports: the fixtures import must
// stay first — its vi.mock registrations only apply to modules imported
// after it is evaluated.
import {
  mockMerchantState,
  mockStorefrontUiState,
  resetProductGridTestState,
} from './product-grid-test-fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '@/lib/api-client';
import { StorefrontProductGrid } from './product-grid';

describe('StorefrontProductGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProductGridTestState();
  });

  it.each([
    '',
    '/test-merchant',
  ])('passes routing basePath %s to cards and quick view', async (basePath) => {
    mockMerchantState.basePath = basePath;
    render(<StorefrontProductGrid />);
    expect(
      await screen.findByRole('link', { name: 'Card base path' })
    ).toHaveAttribute('href', basePath || '/');
    expect(
      screen.getByRole('link', { name: 'Quick view base path' })
    ).toHaveAttribute('href', basePath || '/');
  });

  it('renders without crashing', async () => {
    render(<StorefrontProductGrid />);
    await waitFor(() => {
      expect(screen.getByText('Test Product')).toBeInTheDocument();
    });
    // This guards the stale-list regression found in Chrome after creating a
    // dashboard product and reopening the generated storefront.
    expect(apiGet).toHaveBeenCalledWith(
      '/api/storefront/products?merchant_id=m1&compact=true&has_images=true',
      { cache: 'no-store' }
    );
  });

  it('renders category buttons with correct aria-pressed state', async () => {
    render(<StorefrontProductGrid />);
    await waitFor(() => {
      // 'Fashion' is not selected by default ('All' is)
      const fashionButton = screen.getByText('Fashion').closest('button');
      expect(fashionButton).toHaveAttribute('aria-pressed', 'false');

      // 'All' should be selected
      const allButton = screen.getByText('All').closest('button');
      expect(allButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('records an explicit submission when the did-you-mean suggestion is chosen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    try {
      mockStorefrontUiState.searchQuery = 'iphon';
      mockMerchantState.basePath = '/test-merchant';
      render(<StorefrontProductGrid />);
      const suggestion = await screen.findByRole('button', {
        name: /did you mean iphone/i,
      });
      fireEvent.click(suggestion);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        '/api/search/submissions',
        expect.objectContaining({
          body: JSON.stringify({
            query: 'iphone',
            pathPrefix: '/test-merchant',
            source: 'did-you-mean',
          }),
          keepalive: true,
        })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders live region with correct status text', async () => {
    render(<StorefrontProductGrid />);

    await waitFor(() => {
      const expectedText = /1 product found/i;
      expect(screen.getByText(expectedText)).toBeInTheDocument();

      const liveRegion = screen
        .getByText(expectedText)
        .closest('[aria-live="polite"]');
      expect(liveRegion).toBeInTheDocument();
    });
  });
});
