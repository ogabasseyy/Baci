import { act, fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';

vi.mock('next/dynamic', async () => {
  const chromeModule = await vi.importActual<typeof import('./ProductGridItemChrome')>(
    './ProductGridItemChrome'
  );

  return {
    default: (loader: () => Promise<unknown>) => {
      const source = loader.toString();

      if (source.includes('ProductGridImageChrome')) {
        return chromeModule.ProductGridImageChrome;
      }

      if (source.includes('ProductGridContentChrome')) {
        return chromeModule.ProductGridContentChrome;
      }

      return () => null;
    },
  };
});

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '/ogabassey' }),
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

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    <img {...props} alt={String(props.alt ?? '')} />
  ),
}));
// Product images now render through CdnFormatImage (explicit per-format
// <picture>). Its real pipeline calls next/image's `getImageProps`; surface it
// as a plain <img> so these tests keep asserting grid-item behavior (including
// the onLoad/onError skeleton transitions).
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...imageProps } = props;

    return <img {...imageProps} alt={String(props.alt ?? '')} />;
  },
}));

import { ProductGridItem } from './ProductGridItem';

const baseProduct: Product = {
  id: 'product-1',
  name: 'iPhone 17 Pro Max',
  price: '₦2,100,000',
  image: '/iphone.jpg',
  category: 'Smartphones',
  slug: 'iphone-17-pro-max',
  categories: {
    id: 'cat-smartphones',
    name: 'Smartphones',
    slug: 'smartphones',
  },
  rating: 4.9,
  description: 'Flagship phone with top-tier camera and performance.',
  condition: 'New',
  images: ['/iphone-black.jpg', '/iphone-gold.jpg'],
  colors: [
    { name: 'Black', value: '#111111' },
    { name: 'Gold', value: '#d4af37' },
  ],
};

describe('ProductGridItem', () => {
  let observerCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    vi.useFakeTimers();

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      observe() {
        return;
      }

      disconnect() {
        return;
      }

      unobserve() {
        return;
      }

      takeRecords() {
        return [];
      }
    }

    global.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    observerCallback = null;
    delete (
      globalThis as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver;
  });

  it('defers heavy interactive chrome when requested', () => {
    render(
      <ProductGridItem
        product={baseProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
        deferInteractiveChrome={true}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Add to wishlist' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: `Add ${baseProduct.name} to cart`,
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Previous color' })
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(
      screen.getByRole('button', { name: 'Add to wishlist' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: `Add ${baseProduct.name} to cart`,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Previous color' })
    ).toBeInTheDocument();
  });

  it('can defer interactive chrome until real interaction only', () => {
    render(
      <ProductGridItem
        product={baseProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
        deferInteractiveChrome={true}
        interactiveChromeTimeoutMs={0}
        interactiveChromeActivateOnIdle={false}
      />
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(
      screen.queryByRole('button', { name: 'Add to wishlist' })
    ).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown'));
    });

    expect(
      screen.getByRole('button', { name: 'Add to wishlist' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: `Add ${baseProduct.name} to cart`,
      })
    ).toBeInTheDocument();
  });

  it('waits to mount deferred images until the card is near the viewport', () => {
    render(
      <ProductGridItem
        product={baseProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
        deferImageLoading={true}
      />
    );

    expect(screen.queryByAltText(baseProduct.name)).not.toBeInTheDocument();

    act(() => {
      observerCallback?.(
        [
          {
            isIntersecting: true,
            target: screen.getByText(baseProduct.name),
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByAltText(baseProduct.name)).toBeInTheDocument();
  });

  it('uses explicit mapped alt text for the rendered grid image', () => {
    render(
      <ProductGridItem
        product={{
          ...baseProduct,
          image: '/iphone-black.jpg',
          image_alt: 'Merchant-provided front view',
        }}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    expect(
      screen.getByAltText('Merchant-provided front view')
    ).toBeInTheDocument();
  });

  it('marks the product photo canvas so dark mode keeps transparent assets on a neutral surface', () => {
    render(
      <ProductGridItem
        product={baseProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    expect(
      screen
        .getByAltText(baseProduct.name)
        .closest('.ogabassey-product-card-image-surface')
    ).toBeInTheDocument();
  });

  it('falls back to the product name after selecting a non-primary image', () => {
    render(
      <ProductGridItem
        product={{
          ...baseProduct,
          image: '/iphone-black.jpg',
          image_alt: 'Merchant-provided front view',
        }}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select color Gold' }));

    expect(screen.getByAltText(baseProduct.name)).toHaveAttribute(
      'src',
      '/iphone-gold.jpg'
    );
  });

  it('uses preserved payload alt text after selecting a non-primary image', () => {
    render(
      <ProductGridItem
        product={{
          ...baseProduct,
          image: '/iphone-black.jpg',
          image_alt: 'Merchant-provided front view',
          image_payloads: [
            { url: '/iphone-black.jpg', alt: 'Black front view' },
            { url: '/iphone-gold.jpg', alt: 'Gold side angle' },
          ],
        }}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select color Gold' }));

    expect(screen.getByAltText('Gold side angle')).toHaveAttribute(
      'src',
      '/iphone-gold.jpg'
    );
  });

  it('renders blank-image grid placeholders as decorative images', () => {
    const { container } = render(
      <ProductGridItem
        product={{
          ...baseProduct,
          image: '   ',
          images: ['  '],
          image_alt: 'Should not describe a placeholder',
        }}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    const image = container.querySelector('img');

    expect(image).toHaveAttribute('alt', '');
    expect(image?.getAttribute('src')).toContain('data:image/svg+xml');
  });

  it('reveals an image that was already complete before hydration attached onLoad', () => {
    // Arrange: jsdom images are never `complete`, so simulate a warm-cache
    // SSR'd <img> by patching the prototype BEFORE render — the mount-time
    // ref callback must flip the loaded state without any onLoad event.
    const completeSpy = vi
      .spyOn(window.HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(true);
    const naturalWidthSpy = vi
      .spyOn(window.HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(640);

    // Act
    const { container } = render(
      <ProductGridItem
        product={baseProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    // Assert: no skeleton pulse, image visible — without firing a load event.
    const image = container.querySelector('img');
    expect(image?.className).toContain('opacity-100');
    expect(container.querySelector('.animate-pulse')).toBeNull();

    completeSpy.mockRestore();
    naturalWidthSpy.mockRestore();
  });

  it('does not re-read image layout properties on subsequent re-renders after loading', () => {
    const completeSpy = vi
      .spyOn(window.HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(true);
    const naturalWidthSpy = vi
      .spyOn(window.HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(640);

    const { rerender } = render(
      <ProductGridItem
        product={baseProduct}
        onAddToCart={vi.fn()}
        isAdded={false}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(naturalWidthSpy).toHaveBeenCalledTimes(1);

    rerender(
      <ProductGridItem
        product={baseProduct}
        onAddToCart={vi.fn()}
        isAdded={true}
        isWishlisted={false}
        onToggleWishlist={vi.fn()}
      />
    );

    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(naturalWidthSpy).toHaveBeenCalledTimes(1);

    completeSpy.mockRestore();
    naturalWidthSpy.mockRestore();
  });
});

