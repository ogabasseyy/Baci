import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import type { Product } from '@/lib/products';
import ProductDetailClient from './product-detail-client';

const mockUseSearchParams = vi.fn(() => new URLSearchParams());
const mockAddToCart = vi.fn();
const mockUpdateQuantity = vi.fn();
const mockSetMerchantSlug = vi.fn();
const mockStickyAddToCart = vi.fn((_props: unknown) => null);
const mockUseCart = vi.fn<
  () => {
    addToCart: typeof mockAddToCart;
    cart: CartItem[];
    setMerchantSlug: typeof mockSetMerchantSlug;
    updateQuantity: typeof mockUpdateQuantity;
  }
>(() => ({
  addToCart: mockAddToCart,
  cart: [],
  setMerchantSlug: mockSetMerchantSlug,
  updateQuantity: mockUpdateQuantity,
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <div data-alt={alt} data-src={src} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('@/components/storefront/breadcrumbs', () => ({
  Breadcrumbs: () => null,
}));

vi.mock('@/components/storefront/deferred-sticky-add-to-cart', () => ({
  DeferredStickyAddToCart: (props: unknown) => {
    mockStickyAddToCart(props);
    return null;
  },
}));

vi.mock('@/components/themed', () => ({
  ThemedBadge: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ThemedButton: ({
    children,
    colorRole: _colorRole,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { colorRole?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: () => null,
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => mockUseCart(),
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    currencyCode: 'NGN',
    formatCurrency: (amount: number) => `₦${amount}`,
  }),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({
    basePath: '',
    merchant: { id: 'merchant-1', slug: 'teststore' },
  }),
}));

vi.mock('@/hooks/use-recently-viewed', () => ({
  useRecentlyViewed: () => ({
    addToRecentlyViewed: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/lib/event-tracking', () => ({
  trackEvent: {
    addToCart: vi.fn(),
    productView: vi.fn(),
  },
}));

function makeBaseProduct(): Product {
  return {
    id: 'product-1',
    name: 'iPad 11th Gen',
    description: 'Tablet',
    status: 'active',
    price: 550000,
    manage_stock: true,
    stock: 10,
    image: '/ipad.jpg',
    imageLarge: '/ipad.jpg',
    imageHint: 'ipad',
    brand: 'Apple',
    gtin: '',
    mpn: '',
    slug: 'ipad-11th-gen',
    condition: 'new',
    category: 'Tablets',
    category_slug: 'tablets',
  };
}

describe('ProductDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockUseCart.mockReturnValue({
      addToCart: mockAddToCart,
      cart: [],
      setMerchantSlug: mockSetMerchantSlug,
      updateQuantity: mockUpdateQuantity,
    });
  });

  it('matches simple in-cart rows when the stored product condition is null', async () => {
    mockUseCart.mockReturnValue({
      addToCart: mockAddToCart,
      cart: [
        {
          id: 'product-1',
          name: 'iPad 11th Gen',
          description: 'Tablet',
          status: 'active',
          price: 550000,
          manage_stock: true,
          stock: 10,
          image: '/ipad.jpg',
          imageLarge: '/ipad.jpg',
          imageHint: 'ipad',
          brand: 'Apple',
          gtin: '',
          mpn: '',
          slug: 'ipad-11th-gen',
          quantity: 2,
        } as CartItem,
      ],
      setMerchantSlug: mockSetMerchantSlug,
      updateQuantity: mockUpdateQuantity,
    });

    render(
      <ProductDetailClient
        product={{
          ...makeBaseProduct(),
          condition: undefined,
        }}
      />
    );

    const increaseButton = await screen.findByLabelText(
      'Increase quantity of iPad 11th Gen'
    );
    increaseButton.click();

    expect(mockUpdateQuantity).toHaveBeenCalledWith('product-1', 3, undefined);
  });

  it('treats missing manage_stock as unlimited stock on the storefront PDP', async () => {
    const { manage_stock: _manageStock, ...product } = {
      ...makeBaseProduct(),
      stock: 0,
    };

    render(<ProductDetailClient product={product as Product} />);

    expect(screen.getByText('Unlimited stock available')).toBeInTheDocument();
    expect(screen.queryByText('Out of Stock')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockStickyAddToCart).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedStock: Number.POSITIVE_INFINITY,
        })
      );
    });
  });

  it('routes the in-cart action through the cart so opt-outs precede checkout', async () => {
    mockUseCart.mockReturnValue({
      addToCart: mockAddToCart,
      cart: [
        {
          id: 'product-1',
          name: 'iPad 11th Gen',
          price: 600000,
          quantity: 1,
          slug: 'ipad-11th-gen',
        } as CartItem,
      ],
      setMerchantSlug: mockSetMerchantSlug,
      updateQuantity: mockUpdateQuantity,
    });

    render(<ProductDetailClient product={makeBaseProduct()} />);

    // The cart page carries the optional-service disclosure and toggle;
    // a direct checkout link would strand default-on fees at payment.
    const action = await screen.findByRole('link', {
      name: 'View Cart and Checkout',
    });
    expect(action).toHaveAttribute('href', '/cart');
  });
});
