import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

vi.mock('@/lib/storefront-price-negotiation', () => ({
  hasStorefrontPriceNegotiation: vi.fn(() => true),
}));

let mockMerchant: { id: string; slug: string } | null = { id: 'merchant-abc', slug: 'test-store' };

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({
    merchant: mockMerchant,
    basePath: mockMerchant ? `/${mockMerchant.slug}` : '/test-store',
  }),
}));

const mockSetIsCartOpen = vi.fn();
const mockRemoveFromCart = vi.fn();
const mockUpdateQuantity = vi.fn();
const mockApplyNegotiatedPrice = vi.fn();
const mockApplyCartWideNegotiation = vi.fn();
const mockClearNegotiatedPrice = vi.fn();
const mockToggleAssurance = vi.fn();

type MockCartItem = {
  id: string;
  cartItemId: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  category: string;
  brand: string;
  negotiatedPrice?: number;
  negotiationStatus?: 'accepted';
  quizAwardId?: string;
  quizVoucherToken?: string;
};

let mockCartItems: MockCartItem[] = [
  {
    id: 'p1',
    cartItemId: 'ci-1',
    name: 'Test Shoe',
    price: 15000,
    quantity: 1,
    image: '/shoe.jpg',
    category: 'shoes',
    brand: 'TestBrand',
    negotiatedPrice: 10000,
    negotiationStatus: 'accepted' as const,
  },
];

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    isCartOpen: true,
    setIsCartOpen: mockSetIsCartOpen,
    cart: mockCartItems,
    removeFromCart: mockRemoveFromCart,
    updateQuantity: mockUpdateQuantity,
    applyNegotiatedPrice: mockApplyNegotiatedPrice,
    applyCartWideNegotiation: mockApplyCartWideNegotiation,
    clearNegotiatedPrice: mockClearNegotiatedPrice,
    toggleAssurance: mockToggleAssurance,
    cartTotal: 10000,
  }),
}));

vi.mock('@/lib/analytics', () => ({
  analytics: { viewCart: vi.fn() },
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    <img {...props} alt={String(props.alt || '')} />
  ),
}));

// Cart line-item images now render through CdnFormatImage (explicit per-format
// <picture>); surface it as a plain <img> so these tests keep asserting sidebar
// behavior, not image internals.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    return <img {...rest} alt={String(props.alt || '')} />;
  },
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('./AdUnit', () => ({
  AdUnit: () => <div data-testid="ad-unit" />,
}));

vi.mock('./empty-state', () => ({
  EmptyState: ({
    actionLabel,
    description,
    onAction,
    title,
  }: {
    actionLabel?: string;
    description: string;
    onAction?: () => void;
    title: string;
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {actionLabel ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }),
  }),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { analytics } from '@/lib/analytics';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { CartSidebar } from './CartSidebar';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CartSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasStorefrontPriceNegotiation).mockReturnValue(true);
    mockMerchant = { id: 'merchant-abc', slug: 'test-store' };
    mockCartItems = [
      {
        id: 'p1',
        cartItemId: 'ci-1',
        name: 'Test Shoe',
        price: 15000,
        quantity: 1,
        image: '/shoe.jpg',
        category: 'shoes',
        brand: 'TestBrand',
        negotiatedPrice: 10000,
        negotiationStatus: 'accepted' as const,
      },
    ];
  });

  it('renders cart items when open', () => {
    render(<CartSidebar />);
    expect(screen.getByText('Test Shoe')).toBeInTheDocument();
  });

  it('reports full cart items to analytics without remapping', () => {
    render(<CartSidebar />);

    expect(vi.mocked(analytics.viewCart)).toHaveBeenCalledWith(
      [
        {
          product: expect.objectContaining({
            id: 'p1',
            cartItemId: 'ci-1',
            name: 'Test Shoe',
          }),
          quantity: 1,
        },
      ],
      'NGN',
      expect.objectContaining({ merchantId: 'merchant-abc' })
    );
  });

  it('renders cart-specific empty copy in the sidebar', () => {
    mockCartItems = [];

    render(<CartSidebar />);

    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(
      screen.getByText('Add an item to your cart and it will appear here.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/currently not available/i)
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start Shopping' }));
    expect(mockSetIsCartOpen).toHaveBeenCalledWith(false);
  });

  it('links cart items to canonical product routes', () => {
    render(<CartSidebar />);
    expect(screen.getAllByRole('link', { name: /test shoe/i })[0]).toHaveAttribute(
      'href',
      '/test-store/shoes/test-shoe'
    );
  });

  it('renders Negotiate Total Amount button', () => {
    render(<CartSidebar />);
    expect(
      screen.getByRole('button', { name: /negotiate total amount/i })
    ).toBeInTheDocument();
  });

  it('opens negotiation modal with type=total when Negotiate Total is clicked', () => {
    // The fixture has an individual offer, so a whole-cart negotiation must
    // confirm clearing it first before the modal opens.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CartSidebar />);
    fireEvent.click(
      screen.getByRole('button', { name: /negotiate total amount/i })
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockClearNegotiatedPrice).toHaveBeenCalled();
    // The NegotiationModal should now be visible
    expect(screen.getByPlaceholderText('Enter amount...')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('closes sidebar when X button is clicked', () => {
    render(<CartSidebar />);
    // Find close button by aria-label or the X icon
    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);
    expect(mockSetIsCartOpen).toHaveBeenCalledWith(false);
  });

  it('does not open negotiation modal when merchant is unavailable', () => {
    mockMerchant = null;
    render(<CartSidebar />);
    const negotiateBtn = screen.getByRole('button', { name: /negotiate total amount/i });
    fireEvent.click(negotiateBtn);
    expect(screen.queryByPlaceholderText('Enter amount...')).not.toBeInTheDocument();
  });

  it('hides negotiation controls and ignores negotiated price when not entitled', () => {
    vi.mocked(hasStorefrontPriceNegotiation).mockReturnValue(false);
    render(<CartSidebar />);

    // Should not render Negotiate Total Amount button
    expect(
      screen.queryByRole('button', { name: /negotiate total amount/i })
    ).not.toBeInTheDocument();

    // Should display original subtotal (15000) instead of negotiated (10000)
    expect(screen.getAllByText('₦15,000')[0]).toBeInTheDocument();
  });

  it('hides item and total negotiation for best-price cart lines', () => {
    vi.mocked(hasStorefrontPriceNegotiation).mockReturnValue(true);
    mockCartItems = [
      {
        id: 'p1',
        cartItemId: 'ci-1',
        name: 'Tecno Spark 50',
        price: 120000,
        quantity: 1,
        image: '/tecno.jpg',
        category: 'electronics',
        brand: 'Tecno',
      },
    ];

    render(<CartSidebar />);

    expect(
      screen.queryByRole('button', { name: /^negotiate$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /negotiate total amount/i })
    ).not.toBeInTheDocument();
  });

  it('shows signed quiz voucher items as free gifts in the sidebar total', () => {
    mockCartItems = [
      {
        id: 'p1',
        cartItemId: 'ci-1',
        name: 'Paid Shoe',
        price: 15000,
        quantity: 1,
        image: '/shoe.jpg',
        category: 'shoes',
        brand: 'TestBrand',
      },
      {
        id: 'gift-1',
        cartItemId: 'gift-1::quiz',
        name: 'Quiz Gift',
        price: 205000,
        quantity: 1,
        image: '/gift.jpg',
        category: 'phones',
        brand: 'Tecno',
        quizAwardId: 'award-1',
        quizVoucherToken: 'signed-token',
      },
    ];

    render(<CartSidebar />);

    expect(screen.getByText('Quiz Gift')).toBeInTheDocument();
    expect(screen.getByText('Free gift')).toBeInTheDocument();
    expect(screen.getAllByText('₦15,000')[0]).toBeInTheDocument();
    expect(screen.queryByText('₦220,000')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /^negotiate$/i })
    ).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /negotiate total amount/i })
    ).toBeInTheDocument();
  });
});
