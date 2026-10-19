import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductOptionAxisGroup } from './product-option-axis-group';
import type { NormalizedProductDetails } from './product-details-helpers';

function buildProductData(
  overrides: Partial<NormalizedProductDetails> = {}
): NormalizedProductDetails {
  return {
    brand: 'Samsung',
    colorImages: {},
    colors: [],
    condition: 'open_box',
    description: 'A smartphone.',
    detailedSpecs: [],
    displaySize: '',
    id: 'prod-1',
    image: 'https://example.com/img.jpg',
    images: ['https://example.com/img.jpg'],
    name: 'Test Product',
    platforms: [],
    price: '₦500,000',
    ram: '',
    rating: 0,
    rawPrice: 500000,
    reviewCount: 0,
    slug: 'test-product',
    specs: [],
    storage: [],
    ...overrides,
  };
}

const sampleProductData = buildProductData({
  variants: [
    {
      attributes: { storage: '128GB', ram: '8GB' },
      id: 'v1',
      price_override: 100000,
      stock_quantity: 5,
    },
    {
      attributes: { storage: '256GB', ram: '16GB' },
      id: 'v2',
      price_override: 120000,
      stock_quantity: 5,
    },
  ],
});

describe('ProductOptionAxisGroup', () => {
  it('renders single option header without repeating value or showing required badge', () => {
    render(
      <ProductOptionAxisGroup
        axis="storage"
        formatAxisLabel={(axis) => axis.toUpperCase()}
        getAxisOptions={() => ['256GB']}
        onSelectAttribute={vi.fn()}
        productData={sampleProductData}
        selectedAttributes={{ storage: '256GB' }}
      />
    );

    expect(screen.getByText('STORAGE')).toBeInTheDocument();
    expect(screen.queryByText(/Select storage/i)).not.toBeInTheDocument();
    expect(screen.queryByText('* Required')).not.toBeInTheDocument();
  });

  it('renders multi-option header with selected value and triggers onSelectAttribute when clicked', () => {
    const handleSelect = vi.fn();
    render(
      <ProductOptionAxisGroup
        axis="storage"
        formatAxisLabel={(axis) => axis.toUpperCase()}
        getAxisOptions={() => ['128GB', '256GB']}
        onSelectAttribute={handleSelect}
        productData={sampleProductData}
        selectedAttributes={{ storage: '128GB' }}
      />
    );

    expect(screen.getByText(/STORAGE:/i)).toHaveTextContent('128GB');
    expect(screen.getByRole('button', { name: /128GB/i })).toBeInTheDocument();

    const option256 = screen.getByRole('button', { name: /256GB/i });
    fireEvent.click(option256);
    expect(handleSelect).toHaveBeenCalledWith('storage', '256GB');
  });

  it('shows the selection prompt and required indicator when no option is selected', () => {
    render(
      <ProductOptionAxisGroup
        axis="storage"
        formatAxisLabel={(axis) => axis.toUpperCase()}
        getAxisOptions={() => ['128GB', '256GB']}
        onSelectAttribute={vi.fn()}
        productData={sampleProductData}
        selectedAttributes={{}}
      />
    );

    expect(screen.getByText(/Select storage/i)).toBeInTheDocument();
    expect(screen.getByText('* Required')).toBeInTheDocument();
  });

  it('keeps multi-option buttons outside a label so they retain button semantics', () => {
    render(
      <ProductOptionAxisGroup
        axis="storage"
        formatAxisLabel={(axis) => axis.toUpperCase()}
        getAxisOptions={() => ['128GB', '256GB']}
        onSelectAttribute={vi.fn()}
        productData={sampleProductData}
        selectedAttributes={{}}
      />
    );

    const option = screen.getByRole('button', { name: /128GB/i });
    expect(option.closest('label')).toBeNull();
    expect(option.tagName).toBe('BUTTON');
  });

  it('returns null when there are no options for the axis', () => {
    const { container } = render(
      <ProductOptionAxisGroup
        axis="storage"
        formatAxisLabel={(axis) => axis.toUpperCase()}
        getAxisOptions={() => []}
        onSelectAttribute={vi.fn()}
        productData={sampleProductData}
        selectedAttributes={{}}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
