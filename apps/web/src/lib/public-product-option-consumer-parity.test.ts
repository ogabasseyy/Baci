import { describe, expect, it } from 'vitest';
import type { hydrateSearchProductAvailability } from '../../mcp-server/search-product-availability';
import { selectStructuredDiscoveryOffer } from '../../mcp-server/select-structured-discovery-offer';
import { resolveCurrentOffer } from '../components/storefront/ogabassey/pages/product-details-page/offer-resolution';
import type { NormalizedProductDetails } from '../components/storefront/ogabassey/pages/product-details-page/product-normalization';
import { resolvePublicProductOption } from './resolve-public-product-option';

describe('PDP/public option value parity', () => {
  it.each([
    null,
    0,
    2,
  ])('preserves selected variant price and effective stock (%s)', (stockQuantity) => {
    const parent = {
      price: 100000,
      manage_stock: true,
      stock_quantity: 4,
      condition: 'new',
    };
    const variant = {
      id: 'v',
      price_override: 120000,
      stock_quantity: stockQuantity,
    };
    const canonical = resolvePublicProductOption(parent, {
      variant,
      offer: { price: 80000, stock_quantity: 9 },
      condition: 'used',
    });
    const pdp = resolveCurrentOffer(
      {
        ...parent,
        id: 'p',
        rawPrice: parent.price,
        price: '100000',
        offers: [{ condition: 'used', rawPrice: 80000, stock_quantity: 9 }],
      } as unknown as NormalizedProductDetails,
      'used',
      {},
      { attributes: {}, price: 120000, variant }
    );
    expect(pdp.rawPrice).toBe(canonical.price);
    expect(pdp.stock).toBe(canonical.stockQuantity);
    const searchRow = {
      product: {
        ...parent,
        id: 'p',
        has_variants: true,
        has_condition_offers: true,
      },
      availableVariants: [variant],
      allVariants: [variant],
      availableOffers: [
        { id: 'used', price: 80000, stock_quantity: 9, condition: 'used' },
      ],
      basePurchasable: false,
    } as unknown as Awaited<
      ReturnType<typeof hydrateSearchProductAvailability>
    >[number];
    const search = selectStructuredDiscoveryOffer(searchRow, {
      alternatives: [{}],
    });
    if (canonical.purchasable) {
      expect(search?.displayPrice).toBe(canonical.price);
      expect(search?.stockSummary.inStock).toBe(true);
    } else {
      expect(search).toBeUndefined();
    }
  });
});
