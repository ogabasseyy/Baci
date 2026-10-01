import { vi } from 'vitest';
import type { NewOrderProductSheetController } from './NewOrderProductSheet';
import type { SelectableOrderProduct } from './new-order.types';

export function makeController(
  overrides: Partial<NewOrderProductSheetController> = {}
): NewOrderProductSheetController {
  return {
    closeProductModal: vi.fn(),
    colors: {
      background: '#ffffff',
      backgroundLight: '#f8fafc',
      border: '#e2e8f0',
      card: '#ffffff',
      cardHover: '#f1f5f9',
      primary: '#2563eb',
      text: '#0f172a',
      textMuted: '#94a3b8',
      textOnPrimary: '#ffffff',
      textSecondary: '#64748b',
    } as NewOrderProductSheetController['colors'],
    fetchMoreProducts: vi.fn(),
    formatPrice: (amount: number) => `₦${amount}`,
    handleAddProduct: vi.fn(),
    handleSelectProduct: vi.fn(),
    hasMoreProducts: true,
    isFetchingMoreProducts: false,
    isLoadingSelectedParentProduct: false,
    isPickingVariant: true,
    productSearch: '',
    productsError: null,
    refetchProducts: vi.fn(),
    refetchSelectedParentProduct: vi.fn(),
    resetProductPickerState: vi.fn(),
    selectableProductRows: [],
    selectedParentProduct: null,
    selectedParentProductError: null,
    setProductSearch: vi.fn(),
    showProductModal: true,
    ...overrides,
  } as NewOrderProductSheetController;
}

export const selectedParentProduct = {
  condition: 'brand_new',
  has_variants: true,
  id: 'product-parent',
  images: ['https://example.com/parent.png'],
  name: 'Baci Phone',
  parent_product_id: null,
  price: 3000,
  sku: 'SKU-PARENT',
  variant_attributes: [],
} satisfies SelectableOrderProduct;

export type ProductSheetRow =
  NewOrderProductSheetController['selectableProductRows'][number];

export function makeVariantRow(
  id: string,
  name: string,
  variant_attributes: ProductSheetRow['variant_attributes'],
  overrides: Partial<ProductSheetRow> = {}
): ProductSheetRow {
  return {
    condition: null,
    has_variants: false,
    id,
    images: [],
    name,
    parent_product_id: 'product-parent',
    price: 3000,
    sku: id.toUpperCase(),
    variant_attributes,
    ...overrides,
  };
}
