import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.fn();
const mockSetIsCartOpen = vi.fn();
const mockClearNegotiatedPrice = vi.fn();
let mockIsCartOpen = true;
let mockMerchant: { id: string; slug: string } | null = {
  id: 'merchant-abc',
  slug: 'test-store',
};

type MockCartItem = {
  id: string;
  cartItemId: string;
  name: string;
  price: number;
  quantity: number;
  variantId?: string;
  image: string;
  category: string;
  brand: string;
  negotiatedPrice?: number;
  negotiationStatus?: 'accepted';
  quizAwardId?: string;
  quizVoucherToken?: string;
};

let mockCartItems: MockCartItem[] = [];

vi.mock('@/contexts/auth-context', () => ({ useAuthSafe: () => ({ user: null }) }));
vi.mock('@/components/storefront/checkout-code-signin', () => ({
  CheckoutCodeSignin: () => <div>Sign in with email</div>,
}));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));
vi.mock('@/lib/storefront-price-negotiation', () => ({
  hasStorefrontPriceNegotiation: vi.fn(() => true),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({
    merchant: mockMerchant,
    basePath: mockMerchant ? `/${mockMerchant.slug}` : '/test-store',
  }),
}));
vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    isCartOpen: mockIsCartOpen,
    setIsCartOpen: mockSetIsCartOpen,
    cart: mockCartItems,
    removeFromCart: vi.fn(),
    updateQuantity: vi.fn(),
    applyNegotiatedPrice: vi.fn(),
    applyCartWideNegotiation: vi.fn(),
    clearNegotiatedPrice: mockClearNegotiatedPrice,
    toggleAssurance: vi.fn(),
    cartTotal: 10000,
  }),
}));
vi.mock('@/lib/analytics', () => ({ analytics: { viewCart: vi.fn() } }));
vi.mock('@/lib/routes', () => ({ asRoute: (path: string) => path }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/test-store',
  useRouter: () => ({ push: mockPush }),
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    <img {...props} alt={String(props.alt || '')} />
  ),
}));
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
vi.mock('./AdUnit', () => ({ AdUnit: () => <div data-testid="ad-unit" /> }));
vi.mock('./empty-state', () => ({ EmptyState: () => <div data-testid="empty-state" /> }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    from: () => ({ insert: vi.fn().mockResolvedValue({ error: null }) }),
  }),
}));

import { analytics } from '@/lib/analytics';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { CartSidebar } from './CartSidebar';

describe('CartSidebar negotiation and analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCartOpen = true;
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
        negotiationStatus: 'accepted',
      },
    ];
  });

  it('opens negotiation modal with type=total when Negotiate Total is clicked', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CartSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /negotiate total amount/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockClearNegotiatedPrice).toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Enter amount...')).toBeInTheDocument();
    const modalLayer = screen.getByRole('dialog', { name: /negotiate price/i }).parentElement;
    const cartLayer = screen.getByRole('button', { name: /dismiss cart backdrop/i }).parentElement;
    expect(cartLayer).toHaveClass('z-80');
    expect(modalLayer).toHaveClass('z-90');
    expect(modalLayer?.parentElement).toBe(cartLayer?.parentElement);
    confirmSpy.mockRestore();
  });

  it('does not open negotiation modal when merchant is unavailable', () => {
    mockMerchant = null;
    render(<CartSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /negotiate total amount/i }));
    expect(screen.queryByPlaceholderText('Enter amount...')).not.toBeInTheDocument();
  });

  it('hides negotiation controls and ignores negotiated price when not entitled', () => {
    vi.mocked(hasStorefrontPriceNegotiation).mockReturnValue(false);
    render(<CartSidebar />);
    expect(screen.queryByRole('button', { name: /negotiate total amount/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('₦15,000')[0]).toBeInTheDocument();
  });

  it('hides item and total negotiation for best-price cart lines', () => {
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
    expect(screen.queryByRole('button', { name: /^negotiate$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /negotiate total amount/i })).not.toBeInTheDocument();
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
    expect(screen.getAllByRole('button', { name: /^negotiate$/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /negotiate total amount/i })).toBeInTheDocument();
  });

  it('tracks logical cart changes without counting metadata enrichment as a new view', () => {
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
      },
    ];
    const view = render(<CartSidebar />);
    expect(analytics.viewCart).toHaveBeenCalledTimes(1);

    mockCartItems = mockCartItems.map((item) => ({
      ...item,
      name: 'Enriched catalog name',
      image: '/enriched.jpg',
    }));
    view.rerender(<CartSidebar />);
    expect(analytics.viewCart).toHaveBeenCalledTimes(1);

    mockCartItems = mockCartItems.map((item) => ({ ...item, quantity: 2 }));
    view.rerender(<CartSidebar />);
    expect(analytics.viewCart).toHaveBeenCalledTimes(2);

    mockCartItems = mockCartItems.map((item) => ({ ...item, price: 16000 }));
    view.rerender(<CartSidebar />);
    expect(analytics.viewCart).toHaveBeenCalledTimes(3);

    mockCartItems = mockCartItems.map((item) => ({
      ...item,
      variantId: 'new-variant',
    }));
    view.rerender(<CartSidebar />);
    expect(analytics.viewCart).toHaveBeenCalledTimes(4);

    mockIsCartOpen = false;
    view.rerender(<CartSidebar />);
    mockIsCartOpen = true;
    view.rerender(<CartSidebar />);
    expect(analytics.viewCart).toHaveBeenCalledTimes(5);
  });
});
