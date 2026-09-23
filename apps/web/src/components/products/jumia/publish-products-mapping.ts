import type { PublishProduct } from '@/schemas/jumia/publish-products';
import type { JumiaProductMappingState } from './publish-products-data-loader';

type SellableProductVariant = {
  id?: string;
  sku: string;
};

function getSellableProductVariants(
  product: PublishProduct
): SellableProductVariant[] {
  const variants = (product.variants ?? [])
    .filter(
      (variant) =>
        variant.is_inventory_anchor !== true &&
        typeof variant.sku === 'string' &&
        variant.sku.trim()
    )
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku?.trim() ?? '',
    }));

  if (variants.length > 0) {
    return variants.filter(
      (variant, index, all) =>
        all.findIndex((candidate) =>
          candidate.id && variant.id
            ? candidate.id === variant.id
            : candidate.sku === variant.sku
        ) === index
    );
  }

  return product.sku?.trim() ? [{ sku: product.sku.trim() }] : [];
}

export function isJumiaProductFullyMapped(
  product: PublishProduct,
  mappings: readonly JumiaProductMappingState[] | undefined
): boolean {
  const sellableVariants = getSellableProductVariants(product);
  if (!mappings || mappings.length === 0) {
    return false;
  }

  const successfulMappings = mappings.filter(
    (mapping) => mapping.syncStatus !== 'error'
  );
  if (sellableVariants.length === 0) {
    return successfulMappings.length > 0;
  }
  const [onlyVariant] = sellableVariants;
  if (sellableVariants.length === 1 && onlyVariant && !onlyVariant.id) {
    // Single-unit product: the caller already scoped these mappings to
    // this product id, so a variant-less mapping identifies the same
    // sellable unit even after a local SKU edit. Matching by SKU here
    // would unmap the product and offer a re-publish that the export
    // reservation rejects with 409.
    return successfulMappings.some(
      (mapping) => !mapping.variantId || mapping.sellerSku === onlyVariant.sku
    );
  }
  return sellableVariants.every((variant) =>
    successfulMappings.some(
      (mapping) =>
        (variant.id && mapping.variantId === variant.id) ||
        ((!mapping.variantId || !variant.id) &&
          mapping.sellerSku === variant.sku)
    )
  );
}
