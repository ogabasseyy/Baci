import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let shouldRenderDeferredShellChildren = true;
let mockProductDetailsStateOverrides: Record<string, unknown> = {};
const mockNegotiationModal = vi.fn(
  (props: Record<string, unknown>) => (
    <div
      data-testid="negotiation-modal"
      data-product-brand={String(props.productBrand ?? '')}
    />
  )
);

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(min-width: 768px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => <img {...props} alt={props.alt as string} />,
}));
vi.mock('next/dynamic', () => {
  function ProductDetailsTabsMock({
    productData,
    activeTab: initialTab = 'description',
    onSelectTab,
  }: {
    productData?: { reviewCount?: number };
    activeTab?: 'description' | 'reviews';
    onSelectTab?: (tab: 'description' | 'reviews') => void;
  }) {
    const reviewCount = productData?.reviewCount ?? 0;
    const [activeTab, setActiveTab] = useState<'description' | 'reviews'>(
      initialTab
    );

    const handleTabChange = (tab: 'description' | 'reviews') => {
      setActiveTab(tab);
      onSelectTab?.(tab);
    };

    return (
      <div>
        <button role="tab" onClick={() => handleTabChange('description')}>
          Description
        </button>
        <button role="tab" onClick={() => handleTabChange('reviews')}>
          {`Reviews (${reviewCount})`}
        </button>
        {activeTab === 'reviews' ? (
          <div role="tabpanel" aria-label={`Reviews (${reviewCount})`}>
            {`Based on ${reviewCount} reviews`}
          </div>
        ) : (
          <div role="tabpanel" aria-label="Description">
            Description
          </div>
        )}
      </div>
    );
  }

  function DeferredProductDetailsSectionsMock(
    props: Record<string, unknown> & {
      productData?: { reviewCount?: number };
    }
  ) {
    return (
      <section aria-label="Deferred product details sections">
        <section aria-label="Deferred ad slot" />
        <ProductDetailsTabsMock {...props} />
        <section aria-label="Deferred merchandising sections" />
      </section>
    );
  }

  return {
    default: (loader: () => Promise<unknown>) => {
      const source = loader.toString();

      return function DynamicComponent(
        props: Record<string, unknown> & {
          productData?: { reviewCount?: number };
        }
      ) {
        if (source.includes('product-details-tabs')) {
          return <ProductDetailsTabsMock {...props} />;
        }

        if (source.includes('BannerCarousel')) {
          return <div data-testid="banner-carousel" />;
        }

        if (source.includes('NegotiationModal')) {
          return mockNegotiationModal(props);
        }

        if (source.includes('deferred-product-details-sections-loader')) {
          return <DeferredProductDetailsSectionsMock {...props} />;
        }

        return null;
      };
    },
  };
});
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  useParams: vi.fn(() => ({ slug: 'test', productSlug: 'test-product' })),
  useRouter: vi.fn(() => ({ push: vi.fn(), back: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));
vi.mock('@/hooks/cart', () => ({
  useCart: vi.fn(() => ({
    cart: [],
    items: [],
    addToCart: vi.fn(),
    totalItems: 0,
    removeFromCart: vi.fn(),
    updateQuantity: vi.fn(),
    applyNegotiatedPrice: vi.fn(),
  })),
}));
vi.mock('@/hooks/merchant/use-merchant', () => ({
  useMerchantSafe: vi.fn(() => ({
    merchant: { id: 'm-1', slug: 'test', business_name: 'Test' },
    basePath: '',
  })),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));
vi.mock('@/components/storefront/brand-products', () => ({
  BrandProducts: () => null,
}));
vi.mock('@/components/storefront/price-range-products', () => ({
  PriceRangeProducts: () => null,
}));

// Mock the V2SavedProvider context
vi.mock('../providers/v2-saved-context', () => ({
  useV2Saved: vi.fn(() => ({
    savedItems: [],
    toggleSaved: vi.fn(),
    isSaved: vi.fn(() => false),
    toastState: { show: false, message: '', type: 'add' },
    dismissToast: vi.fn(),
  })),
  V2SavedProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock the remaining component dependencies
vi.mock('../components/AdUnit', () => ({
  AdUnit: () => null,
}));
vi.mock('../components/BannerCarousel', () => ({
  BannerCarousel: () => null,
}));
vi.mock('../components/BlogSnippet', () => ({
  BlogSnippet: () => null,
}));
vi.mock('../components/deferred-shell-feature', () => ({
  DeferredShellFeature: ({
    children,
    fallback = null,
  }: {
    children: ReactNode;
    fallback?: ReactNode;
  }) => (shouldRenderDeferredShellChildren ? children : fallback),
}));
vi.mock('../components/NegotiationModal', () => ({
  NegotiationModal: () => null,
}));
vi.mock('../components/ProductComparisonTable', () => ({
  ProductComparisonTable: () => null,
}));
vi.mock('../components/ProductVideo', () => ({
  ProductVideo: () => null,
}));
vi.mock('../components/FlyToCartAnimation', () => ({
  FlyToCartAnimation: () => null,
}));
vi.mock('./product-details-page/product-breadcrumbs', () => ({
  ProductBreadcrumbs: () => <nav aria-label="Breadcrumb" />,
}));
vi.mock('./product-details-page/product-interaction-panel', () => ({
  ProductInteractionPanel: () => (
    <div data-testid="commerce-controls">
      <button type="button">Add to Cart</button>
    </div>
  ),
}));
vi.mock('./product-details-page/product-media-gallery', () => ({
  ProductMediaGallery: () => <section aria-label="Product media gallery" />,
}));
vi.mock('./product-details-page/product-mobile-action-bar', () => ({
  ProductMobileActionBar: () => <div data-testid="mobile-action-bar" />,
}));
vi.mock('./product-details-page/product-purchase-panel', () => ({
  ProductPurchasePanel: ({
    productData,
  }: {
    productData: { name: string };
  }) => <h1>{productData.name}</h1>,
}));
vi.mock('./product-details-page/deferred-product-details-sections-loader', () => ({
  DeferredProductDetailsSectionsLoader: (
    props: Record<string, unknown> & {
      productData?: { reviewCount?: number };
      activeTab?: 'description' | 'reviews';
      onSelectTab?: (tab: 'description' | 'reviews') => void;
    }
  ) => {
    const reviewCount = props.productData?.reviewCount ?? 0;
    const [activeTab, setActiveTab] = useState<'description' | 'reviews'>(
      props.activeTab ?? 'description'
    );
    const handleTabChange = (tab: 'description' | 'reviews') => {
      setActiveTab(tab);
      props.onSelectTab?.(tab);
    };

    return shouldRenderDeferredShellChildren ? (
      <section aria-label="Deferred product details sections">
        <section aria-label="Deferred ad slot" />
        <button role="tab" onClick={() => handleTabChange('description')}>
          Description
        </button>
        <button role="tab" onClick={() => handleTabChange('reviews')}>
          {`Reviews (${reviewCount})`}
        </button>
        {activeTab === 'reviews' ? (
          <div role="tabpanel" aria-label={`Reviews (${reviewCount})`}>
            {`Based on ${reviewCount} reviews`}
          </div>
        ) : (
          <div role="tabpanel" aria-label="Description">
            Description
          </div>
        )}
        <section aria-label="Deferred merchandising sections" />
      </section>
    ) : (
      <div data-testid="deferred-product-details-placeholder" />
    );
  },
}));
vi.mock('./product-details-page/selection-required-modal', () => ({
  SelectionRequiredModal: () => null,
}));
vi.mock('./product-details-page/use-product-details-state', () => ({
  useProductDetailsState: (product: {
    id: string;
    name: string;
    price?: string;
    image?: string;
    description?: string;
    condition?: string;
    colors?: string[];
    storage?: string[];
    images?: string[];
    reviews?: number;
    rating?: number;
    brand?: string;
  }) => ({
    activeTab: 'description',
    animatingParticles: [],
    basePath: '',
    cartHref: '/cart',
    currentOffer: { price: product.price ?? '₦0', rawPrice: 15000 },
    deliveryEstimate: 'Tomorrow',
    deliveryLocation: 'Lagos',
    effectiveAxes: [],
    formatAxisLabel: (value: string) => value,
    getAxisOptions: () => [],
    handleAnimationComplete: vi.fn(),
    handleColorDoubleClick: vi.fn(),
    handleColorSelection: vi.fn(),
    handleDecrement: vi.fn(),
    handleIncrement: vi.fn(),
    handleKeyDown: vi.fn(),
    handleMobileAddToCart: vi.fn(),
    handleNegotiationSuccess: vi.fn(),
    handleQuantityBlur: vi.fn(),
    handleQuantityChange: vi.fn(),
    handleShare: vi.fn(),
    handleToggleSaved: vi.fn(),
    homeHref: '/',
    inputValue: '1',
    isLiked: false,
    isNegotiationOpen: false,
    isSelectionModalOpen: false,
    merchantId: 'm-1',
    merchantSlug: 'test',
    missingFields: [],
    normalizedReviewRatingWidth: `${((product.rating ?? 0) / 5) * 100}%`,
    productData: {
      ...product,
      categories: null,
      category: 'General',
      videoUrl: null,
      image: product.image ?? '',
      images: product.images ?? [],
      reviewCount: product.reviews ?? 0,
    },
    quantityInCart: 0,
    relatedProductsProduct: product,
    secondaryColor: null,
    selectedAttributes: {},
    selectedColor: null,
    setSelectedColor: vi.fn(),
    selectedCondition: product.condition ?? 'new',
    selectedImage: product.image ?? '',
    setActiveTab: vi.fn(),
    setDeliveryLocation: vi.fn(),
    setIsNegotiationOpen: vi.fn(),
    setIsSelectionModalOpen: vi.fn(),
    setMissingFields: vi.fn(),
    setSelectedAttributes: vi.fn(),
    setSelectedCondition: vi.fn(),
    setSelectedImage: vi.fn(),
    showColorToast: false,
    validateAndAddToCart: vi.fn(),
    ...mockProductDetailsStateOverrides,
  }),
}));

import { ProductDetailsPage } from './product-details-page';

describe('ProductDetailsPage', () => {
  beforeEach(() => {
    mockMatchMedia(true);
    window.scrollTo = vi.fn();
    shouldRenderDeferredShellChildren = true;
    mockProductDetailsStateOverrides = {};
    mockNegotiationModal.mockClear();
  });

  it('renders the product page shell', async () => {
    render(
      <ProductDetailsPage product={{
        id: 'p-1',
        name: 'Test Product',
        price: '₦5,000',
        image: 'https://example.com/img.jpg',
        description: 'A test product',
        condition: 'new' as const,
        colors: [],
        storage: [],
        images: ['https://example.com/img.jpg'],
      }} />
    );

    const banner = screen.getByRole('region', {
      name: /product banner carousel/i,
    });
    expect(banner).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'Description' })).toBeInTheDocument();
  });

  it('commerce mode renders controls without full product shell sections', () => {
    render(
      <ProductDetailsPage
        mode="commerce"
        product={{
          id: 'p-commerce',
          name: 'Commerce Mode Product',
          price: '₦12,000',
          image: 'https://example.com/commerce.jpg',
          description: 'Commerce only',
          condition: 'new' as const,
          colors: [],
          storage: [],
          images: ['https://example.com/commerce.jpg'],
        }}
        semanticSections={<a href="/smartphones">Shop more Smartphones</a>}
      />
    );

    expect(screen.getByTestId('commerce-controls')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-action-bar')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Commerce Mode Product' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /product banner carousel/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Breadcrumb')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Product media gallery')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Deferred product details sections' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Shop more Smartphones' })
    ).not.toBeInTheDocument();
  });

  it('belowFold mode renders semantic and deferred sections without commerce controls', async () => {
    render(
      <ProductDetailsPage
        mode="belowFold"
        product={{
          id: 'p-below-fold',
          name: 'Below Fold Product',
          price: '₦15,000',
          image: 'https://example.com/below-fold.jpg',
          description: 'Below fold only',
          condition: 'new' as const,
          colors: [],
          storage: [],
          images: ['https://example.com/below-fold.jpg'],
        }}
        semanticSections={<a href="/laptops">Shop more Laptops</a>}
      />
    );

    expect(
      screen.getByRole('link', { name: 'Shop more Laptops' })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('region', {
        name: 'Deferred product details sections',
      })
    ).toBeInTheDocument();
    expect(screen.queryByTestId('commerce-controls')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-action-bar')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Below Fold Product' })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Breadcrumb')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('Product media gallery')
    ).not.toBeInTheDocument();
  });

  it('forwards the product brand to the negotiation modal for brand-aware policy', () => {
    mockProductDetailsStateOverrides = { isNegotiationOpen: true };

    render(
      <ProductDetailsPage
        product={{
          id: 'p-brand-policy',
          name: 'Samsung Galaxy S25',
          brand: 'Samsung',
          price: '₦900,000',
          image: 'https://example.com/samsung.jpg',
          description: 'Brand-aware policy product',
          condition: 'new' as const,
          colors: [],
          storage: [],
          images: ['https://example.com/samsung.jpg'],
        }}
      />
    );

    expect(mockNegotiationModal).toHaveBeenCalled();
    expect(mockNegotiationModal.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        currentPrice: 15000,
        isOpen: true,
        productBrand: 'Samsung',
        productName: 'Samsung Galaxy S25',
      })
    );
  });

  it('uses the real review count and exposes the reviews tab panel semantics', async () => {
    render(
      <ProductDetailsPage product={{
        id: 'p-2',
        name: 'Reviewed Product',
        price: '₦15,000',
        image: 'https://example.com/reviewed.jpg',
        description: 'A reviewed product',
        condition: 'new' as const,
        colors: [],
        storage: [],
        images: ['https://example.com/reviewed.jpg'],
        reviews: 7,
        rating: 4.5,
      }} />
    );

    const reviewsTab = await screen.findByRole('tab', { name: 'Reviews (7)' });
    expect(reviewsTab).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Reviews (124)' })).not.toBeInTheDocument();

    fireEvent.click(reviewsTab);

    expect(
      await screen.findByRole('tabpanel', { name: 'Reviews (7)' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Based on 7 reviews')).toBeInTheDocument();
  });

  it('shows the empty review state when rating data is missing', async () => {
    render(
      <ProductDetailsPage
        product={{
          id: 'p-3',
          name: 'No Reviews Product',
          price: '₦7,500',
          image: 'https://example.com/no-reviews.jpg',
          description: 'No reviews yet',
          condition: 'new' as const,
          colors: [],
          storage: [],
          images: ['https://example.com/no-reviews.jpg'],
        }}
      />
    );

    const reviewsTab = await screen.findByRole('tab', { name: 'Reviews (0)' });
    fireEvent.click(reviewsTab);

    expect(
      await screen.findByRole('tabpanel', { name: 'Reviews (0)' })
    ).toBeInTheDocument();
    expect(await screen.findByText('Based on 0 reviews')).toBeInTheDocument();
  });

  it('renders a fallback shell when image and description data are missing', () => {
    render(
      <ProductDetailsPage
        product={{
          id: 'p-4',
          name: 'Minimal Product',
          price: '₦2,500',
          image: '',
          description: '',
          condition: 'new' as const,
          colors: [],
          storage: [],
          images: [],
        }}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Minimal Product' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /product banner carousel/i })
    ).toBeInTheDocument();
  });

  it('renders a server semantic slot before deferred merchandising content', () => {
    shouldRenderDeferredShellChildren = false;

    render(
      <ProductDetailsPage
        product={{
          id: 'p-5',
          name: 'Samsung Galaxy Z TriFold',
          price: '₦7,150,000',
          image: 'https://example.com/img.jpg',
          description: 'Foldable flagship',
          condition: 'new' as const,
          colors: [],
          storage: [],
          images: ['https://example.com/img.jpg'],
        }}
        semanticSections={
          <div>
            <a href="/smartphones">Shop more Smartphones</a>
          </div>
        }
      />
    );

    expect(
      screen.getByRole('link', { name: 'Shop more Smartphones' })
    ).toBeInTheDocument();
  });
});
