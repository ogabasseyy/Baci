import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows the identity choice from the drawer for a guest', async () => {
    render(<CartSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /proceed to checkout/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Let’s get you started');
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /continue as guest/i }));
    expect(mockPush).toHaveBeenCalledWith('/test-store/checkout');
    expect(mockSetIsCartOpen).toHaveBeenCalledWith(false);
  });

  it('does not navigate or reopen identity after the cart closes during lookup', async () => {
    let resolveLookup: (value: unknown) => void = () => {};
    mockGetUser.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    const { rerender } = render(<CartSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /proceed to checkout/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss cart backdrop/i }));
    mockIsCartOpen = false;
    rerender(<CartSidebar />);
    resolveLookup({ data: { user: { id: 'user-1' } }, error: null });
    mockIsCartOpen = true;
    rerender(<CartSidebar />);
    await waitFor(() => expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeEnabled());
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open identity for a stale guest lookup after reopening the cart', async () => {
    let resolveLookup: (value: unknown) => void = () => {};
    mockGetUser.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));
    const { rerender } = render(<CartSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /proceed to checkout/i }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss cart backdrop/i }));
    mockIsCartOpen = false;
    rerender(<CartSidebar />);
    mockIsCartOpen = true;
    rerender(<CartSidebar />);
    await act(async () => { resolveLookup({ data: { user: null }, error: null }); await Promise.resolve(); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('recognizes a signed-in storefront session without an auth provider', async () => {
    mockSessionUser = { id: 'user-1' };
    render(<CartSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /proceed to checkout/i }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/test-store/checkout'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('takes a signed-in customer directly to checkout', () => {
    mockUser = { id: 'user-1' };
    render(<CartSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /proceed to checkout/i }));
    expect(mockPush).toHaveBeenCalledWith('/test-store/checkout');
  });

});
