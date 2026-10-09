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

  it('hydrates the exact conditioned variant from recognized route params', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams(
        'condition=used&storage=256GB&connectivity=WiFi%2BCellular&utm_source=google'
      )
    );

    const product: Product = {
      ...makeBaseProduct(),
      has_variants: true,
      variants: [
        {
          id: 'variant-new-128',
          product_id: 'product-1',
          merchant_id: 'merchant-1',
          attributes: {
            connectivity: 'WiFi',
            storage: '128GB',
          },
          condition: 'new',
          price_override: 550000,
          stock_quantity: 5,
        },
        {
          id: 'variant-used-256',
          product_id: 'product-1',
          merchant_id: 'merchant-1',
          attributes: {
            connectivity: 'WiFi+Cellular',
            storage: '256GB',
          },
          condition: 'used',
          price_override: 600000,
          stock_quantity: 3,
        },
      ],
    };

    render(<ProductDetailClient product={product} />);

    await waitFor(() => {
      expect(mockStickyAddToCart).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedCondition: 'used',
          selectedPrice: 600000,
          selectedStock: 3,
          selectedVariant: expect.objectContaining({ id: 'variant-used-256' }),
        })
      );
    });

    expect(screen.getByText('₦600000')).toBeInTheDocument();
  });

  it('keeps legacy offer selection driven by the condition query param', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('condition=used&utm_source=google')
    );

    const product: Product = {
      ...makeBaseProduct(),
      has_condition_offers: true,
      offers: [
        {
          id: 'offer-used',
          condition: 'used',
          price: 400000,
          stock_quantity: 2,
        },
      ],
    };

    render(<ProductDetailClient product={product} />);

    await waitFor(() => {
      expect(mockStickyAddToCart).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedCondition: 'used',
          selectedPrice: 400000,
          selectedStock: 2,
          selectedVariant: null,
        })
      );
    });

    expect(screen.getByText('₦400000')).toBeInTheDocument();
  });

  it('honors the exact matched offer even when it has the parent condition', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('condition=new&offer_id=offer-cheaper')
    );
    const product: Product = {
      ...makeBaseProduct(),
      has_condition_offers: true,
      offers: [
        {
          id: 'offer-expensive',
          condition: 'new',
          price: 500000,
          stock_quantity: 5,
        },
        {
          id: 'offer-cheaper',
          condition: 'new',
          price: 400000,
          stock_quantity: 2,
        },
      ],
    };
    render(<ProductDetailClient product={product} />);
    await waitFor(() =>
      expect(mockStickyAddToCart).toHaveBeenLastCalledWith(
        expect.objectContaining({ selectedPrice: 400000, selectedStock: 2 })
      )
    );
    expect(screen.getByText('₦400000')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0]);
    expect(mockStickyAddToCart).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectedPrice: 550000, selectedStock: 10 })
    );
  });

  it('passes the exact offer stock to the cart guard on add', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams('condition=used&offer_id=offer-used')
    );
    const product: Product = {
      ...makeBaseProduct(),
      stock: 0,
      has_condition_offers: true,
      offers: [
        {
          id: 'offer-used',
          condition: 'used',
          price: 400000,
          stock_quantity: 3,
        },
      ],
    };
    render(<ProductDetailClient product={product} />);
    await waitFor(() =>
      expect(mockStickyAddToCart).toHaveBeenLastCalledWith(
        expect.objectContaining({ selectedPrice: 400000, selectedStock: 3 })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }));
    expect(mockAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({ price: 400000, stock: 3 }),
      1,
      { condition: 'used' }
    );
  });
});
