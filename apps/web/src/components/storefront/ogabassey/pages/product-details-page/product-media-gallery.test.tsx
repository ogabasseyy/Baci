import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_PDP_FULL_FRAME_IMAGE_SIZES } from '@/components/storefront/ogabassey/config/product-media';
import type { NormalizedProductDetails } from './product-details-helpers';
import { ProductMediaGallery } from './product-media-gallery';

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => (
    <img
      {...Object.fromEntries(
        Object.entries(props).filter(
          ([key]) => key !== 'fill' && key !== 'preload'
        )
      )}
      alt={String(props.alt ?? '')}
      data-preload={props.preload ? 'true' : undefined}
    />
  ),
}));

// The main gallery image now renders through CdnFormatImage (explicit per-format
// <picture>). Its real pipeline calls next/image's `getImageProps`, which the
// default-only next/image mock above does not expose — surface it as a plain
// <img> so these tests keep asserting gallery behavior, not image internals.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => (
    <img
      {...Object.fromEntries(
        Object.entries(props).filter(
          ([key]) => key !== 'fill' && key !== 'preload'
        )
      )}
      alt={String(props.alt ?? '')}
      data-preload={props.preload ? 'true' : undefined}
    />
  ),
}));

function buildProductData(
  overrides: Partial<NormalizedProductDetails> = {},
): NormalizedProductDetails {
  return {
    id: 'prod-1',
    name: 'Test Product',
    slug: 'test-product',
    price: '₦500,000',
    rawPrice: 500000,
    image: 'https://example.com/img-1.jpg',
    images: [
      'https://example.com/img-1.jpg',
      'https://example.com/img-2.jpg',
      'https://example.com/img-3.jpg',
    ],
    description: 'A smartphone.',
    brand: 'Samsung',
    condition: 'new',
    rating: 4.5,
    reviewCount: 12,
    specs: [],
    detailedSpecs: [],
    colors: [],
    colorImages: {},
    storage: [],
    platforms: [],
    displaySize: '',
    ram: '',
    ...overrides,
  };
}

describe('ProductMediaGallery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders the main product image immediately while deferring thumbnail buttons', async () => {
    render(
      <ProductMediaGallery
        onSelectImage={vi.fn()}
        productData={buildProductData()}
        selectedCondition="new"
        selectedImage={0}
      />,
    );

    expect(screen.getByAltText('Test Product')).toBeInTheDocument();
    expect(screen.getByAltText('Test Product')).toHaveAttribute(
      'sizes',
      OGABASSEY_PDP_FULL_FRAME_IMAGE_SIZES,
    );
    // `preload` (Next 16's replacement for the deprecated `priority`) injects
    // the SSR <link rel="preload"> for LCP; the next/image mock surfaces it as
    // data-preload.
    expect(screen.getByAltText('Test Product')).toHaveAttribute(
      'data-preload',
      'true',
    );
    expect(screen.getByAltText('Test Product')).toHaveAttribute(
      'decoding',
      'sync',
    );
    expect(
      screen.queryByRole('button', { name: 'View image 2' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(
      screen.getByRole('button', { name: 'View image 2' }),
    ).toBeInTheDocument();
  });

  it('does not render redundant thumbnail controls for a single-image product', async () => {
    render(
      <ProductMediaGallery
        onSelectImage={vi.fn()}
        productData={buildProductData({
          images: ['https://example.com/img-1.jpg'],
        })}
        selectedCondition="new"
        selectedImage={0}
      />,
    );

    expect(screen.getByAltText('Test Product')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(
      screen.queryByRole('button', { name: 'View image 1' }),
    ).not.toBeInTheDocument();
  });

  it('activates thumbnail controls on pointer interaction and forwards image selection', async () => {
    const onSelectImage = vi.fn();

    render(
      <ProductMediaGallery
        onSelectImage={onSelectImage}
        productData={buildProductData()}
        selectedCondition="new"
        selectedImage={0}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(window);
    });

    fireEvent.click(screen.getByRole('button', { name: 'View image 3' }));

    expect(onSelectImage).toHaveBeenCalledWith(2);
  });

  it('renders thumbnails through the per-format image path at the q50/96px tier', async () => {
    render(
      <ProductMediaGallery
        onSelectImage={vi.fn()}
        productData={buildProductData()}
        selectedCondition="new"
        selectedImage={0}
      />,
    );

    await act(async () => {
      fireEvent.pointerDown(window);
    });

    // Thumbnails now render through CdnFormatImage (mocked to a plain <img>);
    // verify observable gallery output here, and leave generated format/quality
    // assertions to CdnFormatImage's colocated tests.
    const thumbnail = screen.getByAltText('View 2');
    expect(thumbnail).toHaveAttribute('src', 'https://example.com/img-2.jpg');
    expect(thumbnail).toHaveAttribute('sizes', '96px');
  });

  it('does not activate thumbnail controls on passive scroll or wheel events', async () => {
    // Mock readyState as loading so scheduleIdleActivation() cannot fall back to setTimeout(activate, 0) in jsdom.
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    render(
      <ProductMediaGallery
        onSelectImage={vi.fn()}
        productData={buildProductData()}
        selectedCondition="new"
        selectedImage={0}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'View image 2' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.scroll(window);
      fireEvent.wheel(window);
      vi.advanceTimersByTime(1199);
    });

    expect(
      screen.queryByRole('button', { name: 'View image 2' }),
    ).not.toBeInTheDocument();
  });

  it('falls back to the first working image when the selected image fails to load', () => {
    const onSelectImage = vi.fn();

    render(
      <ProductMediaGallery
        onSelectImage={onSelectImage}
        productData={buildProductData()}
        selectedCondition="new"
        selectedImage={0}
      />,
    );

    const main = screen.getByAltText('Test Product');
    expect(main).toHaveAttribute('src', 'https://example.com/img-1.jpg');

    // The selected image 404s -> the main view falls back to the next image
    // that still loads, never a broken image.
    act(() => {
      fireEvent.error(main);
    });

    expect(screen.getByAltText('Test Product')).toHaveAttribute(
      'src',
      'https://example.com/img-2.jpg',
    );
    expect(onSelectImage).toHaveBeenCalledWith(1);
  });

  it('removes the main image instead of reusing a broken source when every image fails', () => {
    render(
      <ProductMediaGallery
        onSelectImage={vi.fn()}
        productData={buildProductData()}
        selectedCondition="new"
        selectedImage={0}
      />,
    );

    act(() => {
      fireEvent.error(screen.getByAltText('Test Product'));
    });
    act(() => {
      fireEvent.error(screen.getByAltText('Test Product'));
    });
    act(() => {
      fireEvent.error(screen.getByAltText('Test Product'));
    });

    expect(screen.queryByAltText('Test Product')).not.toBeInTheDocument();
  });

});
