import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProductBlurPlaceholder } from '@/lib/image-utils';
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
    delivery: 'generated',
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

describe('LabStorefrontProductCard image contract', () => {
  let product: Product;

  beforeEach(() => {
    vi.clearAllMocks();
    product = labProductFixture({
      imageHint: 'lab card fixture',
      imageLarge: ORIGINAL_HTTPS,
      name: 'Lab Card Product',
    });
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

  it('preserves the production blur placeholder behind the pilot image', () => {
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
    // Same value the control arm paints via next/image: identical category
    // derivation through the identical production generator.
    const category = product.categories?.name || product.category || 'General';
    const blur = getProductBlurPlaceholder(category);
    expect(cloneHtml).toContain('background-image:');
    expect(cloneHtml).toContain(blur);
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
