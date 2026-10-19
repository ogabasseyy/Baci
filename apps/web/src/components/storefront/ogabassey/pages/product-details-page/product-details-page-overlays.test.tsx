import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductDetailsPageOverlays } from './product-details-page-overlays';
import type { NormalizedProductDetails } from './product-normalization';

vi.mock('./product-details-lazy-fly-to-cart-animation', () => ({
  FlyToCartAnimation: ({
    imageSrc,
    onComplete,
  }: {
    imageSrc: string;
    onComplete: () => void;
  }) => (
    <button type="button" data-testid="fly-to-cart" onClick={onComplete}>
      {imageSrc}
    </button>
  ),
}));
vi.mock('./product-details-lazy-selection-required-modal', () => ({
  SelectionRequiredModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="selection-required-modal">
        <button type="button" onClick={onClose}>
          Close selection modal
        </button>
      </div>
    ) : null,
}));
vi.mock('./product-details-lazy-negotiation-modal', () => ({
  NegotiationModal: ({
    onClose,
    productName,
  }: {
    onClose: () => void;
    productName: string;
  }) => (
    <div data-testid="negotiation-modal">
      <span>{productName}</span>
      <button type="button" onClick={onClose}>
        Close negotiation modal
      </button>
    </div>
  ),
}));

const productData = {
  brand: 'Samsung',
  id: 'product-1',
  images: ['https://cdn.example.com/phone.jpg'],
  name: 'Galaxy Phone',
  slug: 'galaxy-phone',
} as unknown as NormalizedProductDetails;

const baseProps = {
  animatingParticles: [],
  currentOfferRawPrice: 150000,
  currentVariantDisplaySelection: null,
  effectiveAxes: ['storage'],
  formatAxisLabel: (axis: string) => axis,
  getAxisOptions: () => ['128GB', '256GB'],
  isNegotiationOpen: false,
  isSelectionModalOpen: false,
  merchantId: 'merchant-1',
  merchantVatRate: 0.075,
  missingFields: [],
  onAnimationComplete: vi.fn(),
  onCloseNegotiation: vi.fn(),
  onCloseSelectionModal: vi.fn(),
  onConfirmSelection: vi.fn(),
  onNegotiationSuccess: vi.fn(),
  onSelectAttribute: vi.fn(),
  onSelectColor: vi.fn(),
  productData,
  selectedAttributes: {},
  selectedColor: null,
  selectedCondition: 'new',
  selectedImage: 0,
  variantSelectionAttributes: {},
};

describe('ProductDetailsPageOverlays', () => {
  it('renders fly-to-cart particles with the selected product image', () => {
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

    expect(screen.getByTestId('fly-to-cart')).toHaveTextContent(
      'https://cdn.example.com/phone.jpg'
    );
  });

  it('does not mount the selection modal when it is closed', () => {
    render(<ProductDetailsPageOverlays {...baseProps} />);

    expect(
      screen.queryByTestId('selection-required-modal')
    ).not.toBeInTheDocument();
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
    render(
      <ProductDetailsPageOverlays
        {...baseProps}
        isNegotiationOpen
      />
    );

    expect(screen.getByTestId('negotiation-modal')).toHaveTextContent(
      'Galaxy Phone'
    );
  });
});
