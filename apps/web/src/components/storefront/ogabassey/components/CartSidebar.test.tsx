import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockUser: { id: string } | null = null;
let mockSessionUser: { id: string } | null = null;
const mockGetUser = vi.fn();
const mockPush = vi.fn();
vi.mock('@/contexts/auth-context', () => ({ useAuthSafe: () => ({ user: mockUser }) }));
vi.mock('@/components/storefront/checkout-code-signin', () => ({ CheckoutCodeSignin: () => <div>Sign in with email</div> }));

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

let mockIsCartOpen = true;

type MockCartItem = {
  id: string;
  cartItemId: string;
  name: string;
  price: number;
  quantity: number;
  variantId?:string;
  variantAttributes?:Record<string,string>;
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
    isCartOpen: mockIsCartOpen,
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
  usePathname: () => '/test-store',
  useRouter: () => ({ push: mockPush }),
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
    auth: { getUser: mockGetUser },
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
    mockUser = null;
    mockSessionUser = null;
    mockGetUser.mockImplementation(async () => ({ data: { user: mockSessionUser }, error: null }));
    mockIsCartOpen=true;
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

  it('shows cart totals without the shipping placeholder', () => {
    render(<CartSidebar />);
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
    expect(screen.getByText('Total', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('Shipping', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Calculated at checkout')).not.toBeInTheDocument();
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

  it('closes sidebar when X button is clicked', () => {
    render(<CartSidebar />);
    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);
    expect(mockSetIsCartOpen).toHaveBeenCalledWith(false);
  });
});
