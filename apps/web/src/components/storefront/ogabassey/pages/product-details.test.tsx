import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  cart: [] as Array<{
    id: string | number;
    quantity: number;
    variantAttributes?: Record<string, string>;
    variantId?: string;
  }>,
  updateQuantity: vi.fn(),
  removeFromCart: vi.fn(),
  compareItems: [] as Array<{
    id: string | number;
    category: string;
  }>,
  addToCompare: vi.fn(),
  removeFromCompare: vi.fn(),
  isInCompare: vi.fn(() => false),
  toggleSaved: vi.fn(),
  isSaved: vi.fn(() => false),
}));

vi.mock('next/image', () => ({
  default: () => 'img',
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn() })),
}));
vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    addToCart: mocks.addToCart,
    cart: mocks.cart,
    removeFromCart: mocks.removeFromCart,
    updateQuantity: mocks.updateQuantity,
  })),
}));
vi.mock('../components/AdUnit', () => ({ AdUnit: () => 'AdUnit' }));
vi.mock('../components/BannerCarousel', () => ({ BannerCarousel: () => 'BannerCarousel' }));
vi.mock('../components/BlogSnippet', () => ({ BlogSnippet: () => 'BlogSnippet' }));
vi.mock('../contexts/ComparisonContext', () => ({
  useComparison: vi.fn(() => ({
    compareItems: mocks.compareItems,
    addToCompare: mocks.addToCompare,
    removeFromCompare: mocks.removeFromCompare,
    isInCompare: mocks.isInCompare,
  })),
}));
vi.mock('../contexts/SavedContext', () => ({
  useSaved: vi.fn(() => ({
    savedItems: [],
    toggleSaved: mocks.toggleSaved,
    isSaved: mocks.isSaved,
    toastState: { show: false, message: '', type: 'add' },
    dismissToast: vi.fn(),
  })),
}));
vi.mock('../data/products', () => ({
  products: [],
}));

import { OgabasseyV2ProductDetails } from './product-details';

describe('OgabasseyV2ProductDetails', () => {
  beforeEach(() => {
    mocks.addToCart.mockReset();
    mocks.cart = [];
    mocks.updateQuantity.mockReset();
    mocks.removeFromCart.mockReset();
    mocks.compareItems = [];
    mocks.addToCompare.mockReset();
    mocks.removeFromCompare.mockReset();
    mocks.isInCompare.mockReset();
    mocks.isInCompare.mockReturnValue(false);
    mocks.toggleSaved.mockReset();
    mocks.isSaved.mockReset();
    mocks.isSaved.mockReturnValue(false);
    window.scrollTo = vi.fn();
  });

  it('exports a valid component', () => {
    expect(OgabasseyV2ProductDetails).toBeDefined();
    expect(typeof OgabasseyV2ProductDetails).toBe('function');
  });

  it('uses the shared Lagos timezone delivery estimate at the PDP boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-10T22:30:00Z'));

    try {
      render(<OgabasseyV2ProductDetails productId="1" />);

      await act(async () => {});
      expect(
        screen.getByText('Est. Delivery: Thu, Jan 11 - Fri, Jan 12')
      ).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(30 * 60 * 1000);
      });
      expect(
        screen.getByText('Est. Delivery: Fri, Jan 12 - Sat, Jan 13')
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not submit an enclosing form when adding a product to the wishlist', () => {
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <OgabasseyV2ProductDetails productId="1" />
      </form>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add to wishlist' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.toggleSaved).toHaveBeenCalled();
  });

  it('does not submit an enclosing form when removing a product from the wishlist', () => {
    mocks.isSaved.mockReturnValue(true);
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <OgabasseyV2ProductDetails productId="1" />
      </form>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove from wishlist' })
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mocks.toggleSaved).toHaveBeenCalled();
  });
});
