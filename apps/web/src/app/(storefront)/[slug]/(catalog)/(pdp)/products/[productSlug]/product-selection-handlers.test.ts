import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import {
  createProductSelectionHandlers,
  type ProductSelectionHandlerInputs,
} from './product-selection-handlers';

const variantProduct = {
  id: 'p2',
  name: 'Phone',
  condition: 'new',
  has_variants: true,
  variants: [
    {
      id: 'v1',
      product_id: 'p2',
      merchant_id: 'm1',
      attributes: { storage: '128 GB' },
      price_override: 100,
      stock_quantity: 5,
      primary_image: '/v1.jpg',
    },
    {
      id: 'v2',
      product_id: 'p2',
      merchant_id: 'm1',
      attributes: { storage: '256 GB' },
      price_override: 150,
      stock_quantity: 5,
      primary_image: '/v2.jpg',
    },
  ],
} as unknown as Product;

function setup(overrides: Partial<ProductSelectionHandlerInputs> = {}) {
  const setters = {
    setIgnoredRouteBaseMatch: vi.fn(),
    setIgnoredRouteOfferId: vi.fn(),
    setSelectedAttributes: vi.fn(),
    setSelectedCondition: vi.fn(),
    setSelectedImage: vi.fn(),
    setSelectedOfferId: vi.fn(),
    setSelectedVariant: vi.fn(),
  };
  const handlers = createProductSelectionHandlers({
    offerIdParam: null,
    product: variantProduct,
    routeSelectionAttributes: {},
    selectedAttributes: {},
    selectedCondition: 'new',
    selectionAttributes: {},
    usesVariantConditions: false,
    usesVariantRouteSelection: true,
    ...setters,
    ...overrides,
  });
  return { ...handlers, ...setters };
}

describe('createProductSelectionHandlers', () => {
  it('commits the resolved variant selection for attribute picks', () => {
    const {
      handleAttributeChange,
      setSelectedAttributes,
      setSelectedVariant,
      setSelectedImage,
    } = setup();
    handleAttributeChange('storage', '256 GB');

    expect(setSelectedAttributes).toHaveBeenCalledWith({ storage: '256 GB' });
    expect(setSelectedVariant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v2' })
    );
    expect(setSelectedImage).toHaveBeenCalledWith('/v2.jpg');
  });

  it('clears the variant when no route selection matches', () => {
    const { handleAttributeChange, setSelectedVariant } = setup();
    handleAttributeChange('storage', '1 TB');

    expect(setSelectedVariant).toHaveBeenCalledWith(null);
  });

  it('matches variants by attributes on the legacy path', () => {
    const { handleAttributeChange, setSelectedVariant, setSelectedImage } =
      setup({ usesVariantRouteSelection: false });
    handleAttributeChange('storage', '128 GB');

    expect(setSelectedVariant).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v1' })
    );
    expect(setSelectedImage).toHaveBeenCalledWith('/v1.jpg');
  });

  it('stops at attributes when the product has no variants', () => {
    const { handleAttributeChange, setSelectedAttributes, setSelectedVariant } =
      setup({ product: { ...variantProduct, variants: undefined } });
    handleAttributeChange('storage', '128 GB');

    expect(setSelectedAttributes).toHaveBeenCalledWith({ storage: '128 GB' });
    expect(setSelectedVariant).not.toHaveBeenCalled();
  });

  it('drops the routed offer and keeps variant state for simple conditions', () => {
    const {
      handleConditionChange,
      setIgnoredRouteBaseMatch,
      setIgnoredRouteOfferId,
      setSelectedCondition,
      setSelectedOfferId,
      setSelectedVariant,
    } = setup({ offerIdParam: 'o1' });
    handleConditionChange('used');

    expect(setIgnoredRouteOfferId).toHaveBeenCalledWith('o1');
    expect(setIgnoredRouteBaseMatch).toHaveBeenCalledWith(true);
    expect(setSelectedCondition).toHaveBeenCalledWith('used');
    expect(setSelectedOfferId).toHaveBeenCalledWith(null);
    expect(setSelectedVariant).not.toHaveBeenCalled();
  });

  it('keys an explicit offer click by identity', () => {
    const { handleConditionChange, setSelectedCondition, setSelectedOfferId } =
      setup({ offerIdParam: 'o1' });
    handleConditionChange('used', 'o2');

    expect(setSelectedCondition).toHaveBeenCalledWith('used');
    expect(setSelectedOfferId).toHaveBeenCalledWith('o2');
  });

  it('reselects the variant when conditions ride the variant axis', () => {
    const { handleConditionChange, setSelectedVariant } = setup({
      usesVariantConditions: true,
      selectionAttributes: { storage: '256 GB' },
    });
    handleConditionChange('used');

    expect(setSelectedVariant).toHaveBeenCalled();
  });
});
