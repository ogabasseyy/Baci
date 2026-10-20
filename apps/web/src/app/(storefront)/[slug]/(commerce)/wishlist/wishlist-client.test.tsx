import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAddToCart = vi.fn();
const mockToast = vi.fn();
const mockFetchWithCsrf = vi.fn();

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => ({
    customer: { email: 'buyer@example.com' },
    isAuthenticated: true,
  }),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({ addToCart: mockAddToCart }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrencyWithCountry: () => ({
    formatCurrency: (amount: number) => `₦${amount}`,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'ogabassey' }),
}));

vi.mock('next/image', () => ({
  default: (props: { alt: string }) => <img alt={props.alt} />,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const { WishListPageClient } = await import('./wishlist-client');

const wishItem = {
  id: 'wish-1',
  created_at: '2026-10-01T00:00:00.000Z',
  product_id: 'prod-1',
  products: {
    id: 'prod-1',
    name: 'Test Gadget',
    slug: 'test-gadget',
    description: 'A gadget',
    price: 100,
    images: [],
    stock_quantity: 5,
    status: 'active',
    category: null,
  },
};

function mockWishlistFetch() {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/wishlist') {
      return { ok: true, json: async () => ({ items: [wishItem] }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('WishListPageClient move to cart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    mockFetchWithCsrf.mockResolvedValue({ ok: true });
    mockWishlistFetch();
  });

  function renderPage() {
    render(
      <WishListPageClient merchantCountry="NG" merchantPayoutCurrency="NGN" />
    );
  }

  it('moves the item to the cart and removes it from the wishlist', async () => {
    mockAddToCart.mockReturnValue('applied');
    renderPage();

    const moveButton = await screen.findByRole('button', {
      name: /move to cart/i,
    });
    fireEvent.click(moveButton);

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        '/api/wishlist?id=wish-1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Added to Cart' })
    );
  });

  it('keeps the item on rejection instead of dropping it', async () => {
    mockAddToCart.mockReturnValue('rejected');
    renderPage();

    const moveButton = await screen.findByRole('button', {
      name: /move to cart/i,
    });
    fireEvent.click(moveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unable to add to cart',
          variant: 'destructive',
        })
      );
    });
    // The line never reached the cart, so the wishlist entry stays.
    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Added to Cart' })
    );
    expect(screen.getByText('Test Gadget')).toBeInTheDocument();
  });
});
