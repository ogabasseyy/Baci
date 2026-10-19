import type { z } from 'zod';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import { structuredDiscoveryIdentity } from './structured-discovery-identity';
import { mcpCatalogRenderInputSchema } from '../src/schemas/mcp-catalog-render';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';

const MAX_CONCURRENT_LOOKUPS = 4;

type SerializedBaseStockStatus = 'in_stock' | 'out_of_stock' | 'not_serialized' | 'unknown';

function normalizeCondition(condition: string | null | undefined) {
  return normalizeCanonicalProductCondition(condition);
}

/** Build the renderer that reloads selected products from authoritative data. */
export function createCatalogRenderer(
  lookup: (id: string) => Promise<{ structuredContent?: unknown }>,
  getSerializedBaseStock: (id: string) => Promise<SerializedBaseStockStatus> = async () => 'not_serialized'
) {
  return async (input: z.infer<typeof mcpCatalogRenderInputSchema>) => {
    try {
      const { products: selections } = mcpCatalogRenderInputSchema.parse(input);
      const uniqueSelections = selections;
      const rendered = new Array<z.infer<typeof mcpToolOutputSchemas.get_product>['products'][number]>(uniqueSelections.length);
      let nextIndex = 0;
      let failed = false;

      const worker = async () => {
        while (!failed) {
          const index = nextIndex++;
          if (index >= uniqueSelections.length) return;
          const selection = uniqueSelections[index];
          let stage: 'lookup' | 'product_validation' | 'option_validation' = 'lookup';
          try {
            const result = await lookup(selection.product_id);
            stage = 'product_validation';
            const parsed = mcpToolOutputSchemas.get_product.parse(result.structuredContent);
            if (
              parsed.variant_lookup_failed ||
              parsed.offer_lookup_failed ||
              parsed.products.length !== 1 ||
              parsed.products[0].id !== selection.product_id ||
              parsed.products[0].price === null
            ) throw new Error('Product unavailable');

            const product = parsed.products[0];
            const option = selection.matched_option;
            if (!option && (product.has_variants || product.has_condition_offers)) {
              throw new Error('An option reference is required for this product');
            }
            if (option) {
              stage = 'option_validation';
              const selectedCondition = normalizeCondition(option.condition);
              if (!selectedCondition) throw new Error('Selected option condition is invalid');
              let price: number | undefined;
              let compareAtPrice: number | null | undefined;
              let condition: string | undefined;
              let availability: 'in_stock' | 'out_of_stock' | 'unconfirmed' = 'unconfirmed';
              let variantId = option.variantId;

              if (option.kind === 'base') {
                const serializedStock = await getSerializedBaseStock(selection.product_id);
                const baseCondition = normalizeCondition(product.base_condition ?? product.condition) || 'new';
                if (
                  option.option_id ||
                  option.variantId ||
                  product.has_variants ||
                  product.base_in_stock === false ||
                  serializedStock === 'out_of_stock' ||
                  serializedStock === 'unknown' ||
                  baseCondition !== selectedCondition
                ) {
                  throw new Error('Base option no longer available');
                }
                price = product.base_price ?? (!product.has_condition_offers ? product.price : null) ?? undefined;
                compareAtPrice = product.compare_at_price;
                condition = baseCondition;
                availability = serializedStock === 'in_stock' || product.base_in_stock === true
                  ? 'in_stock'
                  : 'unconfirmed';
              } else if (option.kind === 'variant') {
                if (!option.option_id) throw new Error('Variant identity missing');
                // Search never pairs a variantId with a variant selection, so
                // a conflicting caller value is a stale selection, not a hint.
                if (variantId && variantId !== option.option_id) throw new Error('Conflicting variant identity');
                const matched = parsed.variants?.find((candidate) => candidate.option_id === option.option_id);
                const matchedCondition = normalizeCondition(matched?.condition ?? product.base_condition ?? product.condition);
                if (!matched || typeof matched.price !== 'number' || !matchedCondition || matchedCondition !== selectedCondition || matched.availability === 'out_of_stock') {
                  throw new Error('Variant no longer available');
                }
                price = matched.price;
                // The storefront PDP falls back to the parent comparison
                // price because the public variants RPC omits variant values.
                compareAtPrice = matched.compare_at_price ?? product.compare_at_price;
                condition = matchedCondition;
                availability = matched.availability;
                variantId = option.option_id;
              } else {
                if (!option.option_id) throw new Error('Offer identity missing');
                if (structuredDiscoveryIdentity.variantsOwnConditionAxis(product, parsed.variants)) {
                  throw new Error('Condition offers are not valid with variant-owned conditions');
                }
                // The PDP ignores a bare condition parameter on variant
                // products (condition-only params resolve zero variant
                // matches), so an unpaired offer would render a price the
                // linked page never shows. Search always pairs these offers.
                if (product.has_variants === true && !variantId) {
                  throw new Error('Paired variant is required for offers on variant products');
                }
                const parentCondition = normalizeCondition(product.base_condition ?? product.condition) || 'new';
                const firstOfferForCondition = parsed.condition_offers?.find(
                  (candidate) => normalizeCondition(candidate.condition) === selectedCondition
                );
                const matched = parsed.condition_offers?.find((candidate) => candidate.offer_id === option.option_id);
                const matchedCondition = normalizeCondition(matched?.condition);
                if (
                  !matched ||
                  !matchedCondition ||
                  matchedCondition !== selectedCondition ||
                  selectedCondition === parentCondition ||
                  firstOfferForCondition?.offer_id !== option.option_id
                ) {
                  throw new Error('Offer no longer available');
                }
                if (variantId) {
                  const pairedVariant = parsed.variants?.find((candidate) => candidate.option_id === variantId);
                  if (!pairedVariant || typeof pairedVariant.price !== 'number' || pairedVariant.availability === 'out_of_stock') {
                    throw new Error('Paired variant no longer available');
                  }
                  price = pairedVariant.price;
                  // The PDP sources the comparison price from the selected
                  // variant or the parent product, never the offer row.
                  compareAtPrice = pairedVariant.compare_at_price ?? product.compare_at_price;
                  availability = pairedVariant.availability;
                } else {
                  if (matched.availability === 'out_of_stock') throw new Error('Offer no longer available');
                  price = matched.price;
                  // Condition-offer compare-at prices are not used by the PDP;
                  // bare offers retain the parent product comparison price.
                  compareAtPrice = product.compare_at_price;
                  availability = matched.availability;
                }
                condition = matchedCondition;
              }

              if (price === undefined || !Number.isFinite(price) || price < 0 || !condition) {
                throw new Error('Selected option is incomplete');
              }
              const url = new URL(`https://ogabassey.com/products/${encodeURIComponent(product.slug || product.id)}`);
              if (option.kind !== 'base') url.searchParams.set('condition', condition);
              if (variantId) url.searchParams.set('variantId', variantId);
              rendered[index] = {
                ...product,
                price,
                compare_at_price: compareAtPrice ?? null,
                condition,
                in_stock: availability === 'in_stock' ? true : null,
                stock_level: availability === 'in_stock' ? 'In Stock' : 'Confirm at checkout',
                stock_confidence: availability === 'in_stock' ? 'high' : 'unconfirmed',
                url: url.toString(),
              };
            } else {
              rendered[index] = product;
            }
          } catch {
            console.error('MCP catalog renderer failed during', stage);
            failed = true;
            return;
          }
        }
      };

      await Promise.all(Array.from(
        { length: Math.min(MAX_CONCURRENT_LOOKUPS, uniqueSelections.length) },
        () => worker()
      ));
      if (failed || rendered.some((product) => !product)) throw new Error('Catalog lookup failed');

      return {
        content: [{
          type: 'text' as const,
          text: 'Showing selected Ogabassey products. Confirm options and availability before checkout.',
        }],
        structuredContent: { products: rendered },
      };
    } catch {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: 'Selected products could not be loaded. Search again before rendering.',
        }],
        structuredContent: {
          products: [],
          status: 'unavailable' as const,
          message: 'Selected products could not be loaded. Search again before rendering.',
        },
      };
    }
  };
}
