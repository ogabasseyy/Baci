import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontProductCard } from '@/components/storefront/product-card';
import type { Product } from '@/lib/products';
import {
  LabStorefrontProductCard,
  labCardSlot,
  labProductFixture,
} from './lab-card-clone';
import type { ApprovedPilotTier } from './lab-index';
import {
  projectControlNextImage,
  projectPilotNextImage,
} from './next-image-adapter';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

// Keep the original's OptimizedImage wrapper logic live; only the terminal
// next/image is mocked (raw-src passthrough + the real lazy default).
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const {
      alt,
      blurDataURL: _blur,
      loading,
      placeholder: _ph,
      src,
      ...rest
    } = props;
    void _blur;
    void _ph;
    const bareSrc = String(src).split('?')[0];
    return (
      // biome-ignore lint/performance/noImgElement: next/image test double must render a DOM image.
      <img
        src={bareSrc}
        alt={alt as string}
        loading={((loading as string) ?? 'lazy') as 'eager' | 'lazy'}
        {...rest}
      />
    );
  },
}));

vi.mock('@/components/themed', () => ({
  ThemedCard: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  ThemedButton: ({
    children,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button type="button" disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrency: () => ({
    formatCurrency: (amount: number) => `$${amount}`,
  }),
}));

vi.mock('@/lib/seo-utils', () => ({
  getProductUrl: () => '/product/lab-product-1',
}));

const CONTROL_URL = '/__pilot/originals/stores/test-store/card.png';
const ORIGINAL_HTTPS = 'https://cdn.example.com/stores/test-store/card.png';

function cardTier(format: 'avif' | 'webp', width: number): ApprovedPilotTier {
  return {
    actualWidth: width,
    bytes: 1000,
    contentType: format === 'avif' ? 'image/avif' : 'image/webp',
    fileName: `card-${width}w.${format}`,
    format,
    generationId: 'gen-test',
    height: Math.round((width * 400) / 600),
    quality: 70,
    requestedWidth: width,
    sha256: '0'.repeat(64),
    width,
  };
}

const PILOT_TIERS: ApprovedPilotTier[] = [
  cardTier('avif', 600),
  cardTier('avif', 1200),
  cardTier('webp', 600),
  cardTier('webp', 1200),
];

function handlers() {
  return {
    onAddToCart: () => {},
    onUpdateQuantity: () => {},
    onQuickView: () => {},
  };
}

function stripImageElement(html: string): string {
  return html
    .replaceAll(/<picture[^>]*>[\s\S]*?<\/picture>/g, '<img/>')
    .replaceAll(/<img[^>]*>/g, '<img/>');
}

describe('LabStorefrontProductCard original-renderer parity', () => {
  let product: Product;

  beforeEach(() => {
    vi.clearAllMocks();
    product = labProductFixture({
      imageHint: 'lab card fixture',
      imageLarge: ORIGINAL_HTTPS,
      name: 'Lab Card Product',
    });
  });

  it('matches the original card structure modulo the image element (control projection)', () => {
    const control = projectControlNextImage({
      originalUrl: CONTROL_URL,
      slot: labCardSlot(product, { priority: false }),
    });
    const originalHtml = renderToStaticMarkup(
      <StorefrontProductCard
        product={product}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabStorefrontProductCard
        product={product}
        projection={control}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    expect(stripImageElement(cloneHtml)).toBe(stripImageElement(originalHtml));
  });

  it('matches with a cart line item (quantity controls verbatim)', () => {
    const control = projectControlNextImage({
      originalUrl: CONTROL_URL,
      slot: labCardSlot(product, { priority: false }),
    });
    const cartItem = {
      cartItemId: 'lab-product-1',
      productId: 'lab-product-1',
      quantity: 2,
    } as never;
    const originalHtml = renderToStaticMarkup(
      <StorefrontProductCard
        product={product}
        cartItem={cartItem}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabStorefrontProductCard
        product={product}
        projection={control}
        cartItem={cartItem}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    expect(stripImageElement(cloneHtml)).toBe(stripImageElement(originalHtml));
    expect(cloneHtml).toContain('Quantity for Lab Card Product');
  });

  it('matches the priority card structure modulo the image element (mounted shape)', () => {
    // The store pages mount the selected card at grid index 0, where
    // production passes priority (high/eager). Lock that shape too.
    const control = projectControlNextImage({
      originalUrl: CONTROL_URL,
      slot: labCardSlot(product),
    });
    expect(control.fetchPriority).toBe('high');
    expect(control.loading).toBe('eager');
    const originalHtml = renderToStaticMarkup(
      <StorefrontProductCard
        product={product}
        staggerClass="stagger-1"
        basePath="/test-store"
        priority
        {...handlers()}
      />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabStorefrontProductCard
        product={product}
        projection={control}
        staggerClass="stagger-1"
        basePath="/test-store"
        {...handlers()}
      />
    );
    expect(stripImageElement(cloneHtml)).toBe(stripImageElement(originalHtml));
    expect(cloneHtml).toContain('fetchPriority="high"');
    expect(cloneHtml).toContain('loading="eager"');
  });

  it('pilot arm differs from the original ONLY in the image element', () => {
    const pilot = projectPilotNextImage({
      baseUrl: CONTROL_URL,
      slot: labCardSlot(product, { priority: false }),
      tiers: PILOT_TIERS,
    });
    expect(pilot).not.toBeNull();
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const originalHtml = renderToStaticMarkup(
      <StorefrontProductCard
        product={product}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    const cloneHtml = renderToStaticMarkup(
      <LabStorefrontProductCard
        product={product}
        projection={pilot}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    expect(stripImageElement(cloneHtml)).toBe(stripImageElement(originalHtml));
    expect(cloneHtml).toContain(`${CONTROL_URL}/gen-test/card-600w.avif 600w`);
    expect(cloneHtml).not.toContain('?w=');
  });

  it('preserves the card image contract (geometry, alt, hint, low/lazy)', () => {
    const pilot = projectPilotNextImage({
      baseUrl: CONTROL_URL,
      slot: labCardSlot(product, { priority: false }),
      tiers: PILOT_TIERS,
    });
    if (!pilot) {
      throw new Error('pilot projection is null');
    }
    const cloneHtml = renderToStaticMarkup(
      <LabStorefrontProductCard
        product={product}
        projection={pilot}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    expect(cloneHtml).toContain('width="600"');
    expect(cloneHtml).toContain('height="400"');
    expect(cloneHtml).toContain('data-ai-hint="lab card fixture"');
    expect(cloneHtml).toContain('fetchPriority="low"');
    expect(cloneHtml).toContain('loading="lazy"');
    expect(cloneHtml).toContain(
      'class="object-cover w-full h-auto aspect-video"'
    );
  });

  it('lab fixture is an in-stock active product with a discount badge', () => {
    expect(product.status).toBe('active');
    expect(product.stock).toBeGreaterThan(0);
    const control = projectControlNextImage({
      originalUrl: CONTROL_URL,
      slot: labCardSlot(product, { priority: false }),
    });
    const cloneHtml = renderToStaticMarkup(
      <LabStorefrontProductCard
        product={product}
        projection={control}
        staggerClass=""
        basePath="/test-store"
        {...handlers()}
      />
    );
    expect(cloneHtml).toContain('-17%');
    expect(cloneHtml).toContain('Add to Cart');
  });
});
