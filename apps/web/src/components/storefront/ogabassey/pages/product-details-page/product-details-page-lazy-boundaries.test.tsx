import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductDetailsPageOverlays } from './product-details-page-overlays';
import type { NormalizedProductDetails } from './product-normalization';

vi.mock('./product-details-lazy-fly-to-cart-animation', () => ({
  FlyToCartAnimation: () => <div data-testid="fly-to-cart" />,
}));
vi.mock('./product-details-lazy-selection-required-modal', () => ({
  SelectionRequiredModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="selection-required-modal" /> : null,
}));
vi.mock('./product-details-lazy-negotiation-modal', () => ({
  NegotiationModal: () => <div data-testid="negotiation-modal" />,
}));

const overlayProductData = {
  brand: 'Samsung',
  id: 'product-1',
  images: ['https://cdn.example.com/phone.jpg'],
  name: 'Galaxy Phone',
  slug: 'galaxy-phone',
} as unknown as NormalizedProductDetails;

const baseProps = {
  animatingParticles: [] as DOMRect[],
  currentOfferRawPrice: 150000,
  effectiveAxes: ['storage'],
  formatAxisLabel: (axis: string) => axis,
  getAxisOptions: () => ['128GB'],
  isNegotiationOpen: false,
  isSelectionModalOpen: false,
  merchantId: 'merchant-1',
  merchantVatRate: 0.075,
  missingFields: [] as string[],
  onAnimationComplete: vi.fn(),
  onCloseNegotiation: vi.fn(),
  onCloseSelectionModal: vi.fn(),
  onConfirmSelection: vi.fn(),
  onNegotiationSuccess: vi.fn(),
  onSelectAttribute: vi.fn(),
  onSelectColor: vi.fn(),
  productData: overlayProductData,
  selectedAttributes: {},
  selectedColor: null,
  selectedCondition: 'new',
  selectedImage: 0,
  variantSelectionAttributes: {},
};

describe('product-details-page lazy boundaries', () => {
  it('does not mount deferred overlay widgets when closed and idle', () => {
    render(<ProductDetailsPageOverlays {...baseProps} />);

    expect(
      screen.queryByTestId('selection-required-modal')
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('negotiation-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fly-to-cart')).not.toBeInTheDocument();
  });

  it('mounts the selection modal only when it is open', () => {
    render(
      <ProductDetailsPageOverlays
        {...baseProps}
        isSelectionModalOpen
        missingFields={['Storage']}
      />
    );

    expect(screen.getByTestId('selection-required-modal')).toBeInTheDocument();
  });

  it('mounts the negotiation modal only when negotiation is open', () => {
    render(<ProductDetailsPageOverlays {...baseProps} isNegotiationOpen />);

    expect(screen.getByTestId('negotiation-modal')).toBeInTheDocument();
  });

  it('mounts fly-to-cart animation only when particles are animating', () => {
    const startRect = {
      bottom: 0,
      height: 10,
      left: 0,
      right: 10,
      top: 0,
      width: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;

    render(
      <ProductDetailsPageOverlays
        {...baseProps}
        animatingParticles={[startRect]}
      />
    );

    expect(screen.getByTestId('fly-to-cart')).toBeInTheDocument();
  });
});
