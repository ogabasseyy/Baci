import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedProductDetails } from './product-details-helpers';
import { ProductOptionSelectors } from './product-option-selectors';

function buildProductData(
  overrides: Partial<NormalizedProductDetails> = {},
): NormalizedProductDetails {
  return {
    id: 'prod-1',
    name: 'Test Product',
    slug: 'test-product',
    price: '₦500,000',
    rawPrice: 500000,
    image: 'https://example.com/img.jpg',
    images: ['https://example.com/img.jpg'],
    description: 'A smartphone.',
    brand: 'Samsung',
    condition: 'open_box',
    rating: 0,
    reviewCount: 0,
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

type ProductVariantFixture = NonNullable<NormalizedProductDetails['variants']>;

const s22Variants: ProductVariantFixture = [
  {
    id: 'v1',
    attributes: { ram: '8GB', storage: '128GB' },
    price_override: 500000,
    stock_quantity: 9999,
  },
  {
    id: 'v2',
    attributes: { ram: '12GB', storage: '256GB' },
    price_override: 550000,
    stock_quantity: 9999,
  },
  {
    id: 'v3',
    attributes: { ram: '12GB', storage: '512GB' },
    price_override: 600000,
    stock_quantity: 9999,
  },
];

function renderSelectors({
  selectedAttributes = {},
  effectiveAxes = ['storage', 'ram'],
  variants = s22Variants,
  getAxisOptions,
  onSelectAttribute = vi.fn() as (axis: string, value: string) => void,
}: {
  selectedAttributes?: Record<string, string>;
  effectiveAxes?: string[];
  variants?: ProductVariantFixture;
  getAxisOptions?: (axis: string) => string[];
  onSelectAttribute?: (axis: string, value: string) => void;
} = {}) {
  const productData = buildProductData({ variants });

  render(
    <ProductOptionSelectors
      deliveryEstimate="1–2 days"
      deliveryLocation="Lagos"
      descriptionExcerpt="Great phone."
      effectiveAxes={effectiveAxes}
      formatAxisLabel={(axis) => axis.toUpperCase()}
      getAxisOptions={getAxisOptions ?? ((axis) => {
        const all = variants.flatMap((v) => {
          const val = v.attributes?.[axis];
          return val ? [val] : [];
        });
        return [...new Set(all)];
      })}
      onChangeDeliveryLocation={vi.fn()}
      onSelectAttribute={onSelectAttribute}
      onSelectColor={vi.fn()}
      onSelectSecondaryColor={vi.fn()}
      productData={productData}
      secondaryColor={null}
      selectedAttributes={selectedAttributes}
      selectedColor={null}
      showColorToast={false}
    />,
  );

  return { onSelectAttribute };
}

describe('ProductOptionSelectors — dependent variant filtering', () => {
  it('renders all storage options as enabled when no RAM is selected', () => {
    renderSelectors({ effectiveAxes: ['storage'] });

    expect(
      screen.getByRole('button', { name: /128GB/i }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: /256GB/i }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: /512GB/i }),
    ).not.toBeDisabled();
  });

  it('disables storage options that have no variant matching the selected RAM', () => {
    renderSelectors({
      selectedAttributes: { ram: '8GB' },
      effectiveAxes: ['storage'],
    });

    const btn128 = screen.getByRole('button', { name: /128GB/i });
    const btn256 = screen.getByRole('button', { name: /256GB/i });
    const btn512 = screen.getByRole('button', { name: /512GB/i });

    expect(btn128).not.toBeDisabled();
    expect(btn256).toBeDisabled();
    expect(btn512).toBeDisabled();
  });

  it('enables multiple storage options when a RAM with multiple pairs is selected', () => {
    renderSelectors({
      selectedAttributes: { ram: '12GB' },
      effectiveAxes: ['storage'],
    });

    expect(
      screen.getByRole('button', { name: /128GB/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /256GB/i }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('button', { name: /512GB/i }),
    ).not.toBeDisabled();
  });

  it('calls onSelectAttribute when an available option is clicked', async () => {
    const user = userEvent.setup();
    const onSelectAttribute = vi.fn();

    renderSelectors({
      selectedAttributes: { ram: '8GB' },
      effectiveAxes: ['storage'],
      onSelectAttribute,
    });

    await user.click(screen.getByRole('button', { name: /128GB/i }));
    expect(onSelectAttribute).toHaveBeenCalledWith('storage', '128GB');
  });

  it('does not call onSelectAttribute when a disabled option is clicked', async () => {
    const user = userEvent.setup();
    const onSelectAttribute = vi.fn();

    renderSelectors({
      selectedAttributes: { ram: '8GB' },
      effectiveAxes: ['storage'],
      onSelectAttribute,
    });

    await user.click(screen.getByRole('button', { name: /256GB/i }));
    expect(onSelectAttribute).not.toHaveBeenCalled();
  });

  it('marks unavailable options as disabled', () => {
    renderSelectors({
      selectedAttributes: { ram: '8GB' },
      effectiveAxes: ['storage'],
    });

    const disabled256 = screen.getByRole('button', { name: /256GB/i });
    expect(disabled256).toBeDisabled();
  });

  it('disables unreachable storage options, leaving reachable ones enabled', () => {
    // ram=8GB only pairs with 128GB — selecting storage=512GB is impossible
    renderSelectors({
      selectedAttributes: { ram: '8GB', storage: '512GB' },
      effectiveAxes: ['storage'],
    });

    // With ram=8GB selected, only 128GB is reachable
    expect(screen.getByRole('button', { name: /128GB/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /256GB/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /512GB/i })).toBeDisabled();
  });

  it('keeps metadata-only single options enabled when variant rows omit that axis', async () => {
    const user = userEvent.setup();
    const onSelectAttribute = vi.fn();

    renderSelectors({
      effectiveAxes: ['storage'],
      getAxisOptions: () => ['128GB'],
      onSelectAttribute,
      variants: [
        {
          id: 'v1',
          attributes: { ram: '8GB' },
          price_override: 500000,
          stock_quantity: 9999,
        },
      ],
    });

    const storageOption = screen.getByRole('button', { name: /128GB/i });
    expect(storageOption).not.toBeDisabled();

    await user.click(storageOption);
    expect(onSelectAttribute).toHaveBeenCalledWith('storage', '128GB');
  });

  it('ignores metadata-only selections when filtering variant-backed options', () => {
    renderSelectors({
      effectiveAxes: ['storage'],
      selectedAttributes: { platform: 'PS5' },
      variants: [
        {
          id: 'v1',
          attributes: { storage: '128GB' },
          price_override: 500000,
          stock_quantity: 9999,
        },
      ],
    });

    expect(
      screen.getByRole('button', { name: /128GB/i }),
    ).not.toBeDisabled();
  });

  it('renders single-option axis label without duplicating the option value in the header', () => {
    renderSelectors({
      effectiveAxes: ['storage'],
      getAxisOptions: () => ['2TB PCIe NVMe SSD'],
      selectedAttributes: { storage: '2TB PCIe NVMe SSD' },
    });

    // The heading shows "STORAGE" only, and does not repeat "2TB PCIe NVMe SSD" in the label
    const label = screen.getByText('STORAGE');
    expect(label).toBeInTheDocument();
    // The option value is present in the button
    expect(
      screen.getByRole('button', { name: /2TB PCIe NVMe SSD/i })
    ).toBeInTheDocument();
  });

  it('renders multi-option axis label with the active selected value', () => {
    renderSelectors({
      effectiveAxes: ['storage'],
      getAxisOptions: () => ['128GB', '256GB', '512GB'],
      selectedAttributes: { storage: '256GB' },
    });

    expect(
      screen.getByRole('button', { name: /Select 256GB storage/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/STORAGE:/i)).toHaveTextContent('256GB');
  });
});
