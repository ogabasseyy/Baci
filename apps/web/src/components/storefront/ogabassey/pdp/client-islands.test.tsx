import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/components/storefront/ogabassey/types';
import { OgabasseyPdpBelowFoldIsland } from './client-islands';

const { mockDeferredDetailIsland, mockProductViewTracker } = vi.hoisted(
  () => ({
    mockDeferredDetailIsland: vi.fn(),
    mockProductViewTracker: vi.fn(),
  })
);

vi.mock('./product-view-tracker.client', () => ({
  OgabasseyPdpProductViewTracker: (props: unknown) => {
    mockProductViewTracker(props);
    return null;
  },
}));

vi.mock('./deferred-detail-island', () => ({
  OgabasseyPdpDeferredDetailIsland: (props: {
    product: { name: string };
    semanticSections?: ReactNode;
    serverPrimaryDetails?: ReactNode;
    storeSlug: string;
  }) => {
    mockDeferredDetailIsland(props);
    return (
      <section aria-label="Product details">
        {props.serverPrimaryDetails}
        {props.semanticSections}
      </section>
    );
  },
}));

const product = {
  id: 'product-1',
  image: 'https://cdn.ogabassey.com/core-assets/products/legion.avif',
  name: 'Lenovo Legion Pro 9',
  price: '₦5,985,000',
  rawPrice: 5_985_000,
  category: 'Laptops',
  slug: 'lenovo-legion-pro-9',
} as unknown as Product;

describe('OgaBassey PDP client islands', () => {
  it('renders below-fold semantic content through the deferred detail island', () => {
    render(
      <OgabasseyPdpBelowFoldIsland
        product={product}
        semanticSections={<section aria-label="Related buying guidance" />}
        serverPrimaryDetails={<section aria-label="Server product details" />}
        storeSlug="ogabassey"
      />
    );

    expect(mockDeferredDetailIsland).toHaveBeenCalledWith(
      expect.objectContaining({
        product,
        semanticSections: expect.anything(),
        serverPrimaryDetails: expect.anything(),
        storeSlug: 'ogabassey',
      })
    );
    expect(screen.getByLabelText('Server product details')).toBeInTheDocument();
    expect(screen.getByLabelText('Related buying guidance')).toBeInTheDocument();
  });

  it('reports the product view from the ogabassey product page', () => {
    // Regression: this page never called the product_view tracker, so web
    // product views were missing for ogabassey in Baci and the ad platforms.
    render(
      <OgabasseyPdpBelowFoldIsland product={product} storeSlug="ogabassey" />
    );

    expect(mockProductViewTracker).toHaveBeenCalledWith({
      productId: 'product-1',
      name: 'Lenovo Legion Pro 9',
      price: 5_985_000,
      category: 'Laptops',
    });
  });
});
