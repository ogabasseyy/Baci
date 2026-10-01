import {
  inferProductVariantModel,
  resolveDefaultVariantSelection,
  resolveProductVariantMedia,
} from '@baci/shared';
import {
  buildParentVariantAttributes,
  buildVariantAttributeRecord,
  getLowestVariantPrice,
  getTotalVariantStock,
} from '@/lib/product-variant-form';
import type { ProductFormValues } from './product';

export function mapProductFormToProductDb(data: ProductFormValues) {
  const { has_variants, variant_attributes, variants, ...rest } = data;

  const attributesRecord =
    variant_attributes?.reduce(
      (acc, curr) => {
        if (curr.key.trim()) {
          acc[curr.key.trim()] = curr.value.trim();
        }
        return acc;
      },
      {} as Record<string, string>
    ) || {};

  const normalizedVariants = variants.map((variant) => ({
    attributes: buildVariantAttributeRecord(variant.attributes),
    condition: variant.condition ?? null,
    cost_price: variant.cost_price ?? null,
    id: variant.id,
    images: variant.images,
    primary_image: variant.primary_image || null,
    price_override: variant.price,
    sku: variant.sku.trim() || null,
    stock_quantity: variant.stock_quantity,
  }));
  const persistedVariants = has_variants ? normalizedVariants : [];

  const variantModel = inferProductVariantModel({
    variants: persistedVariants,
  });
  const defaultSelectionVariants = persistedVariants.map((variant, index) => ({
    ...variant,
    id: variant.id ?? `draft-variant-${index}`,
  }));
  const defaultSelection =
    variantModel === 'sku_matrix'
      ? resolveDefaultVariantSelection({
          price: rest.price,
          manage_stock: rest.manage_stock,
          variants: defaultSelectionVariants,
        })
      : null;
  const nextPrice =
    variantModel === 'sku_matrix'
      ? (defaultSelection?.price ?? rest.price)
      : has_variants
        ? getLowestVariantPrice(variants, rest.price)
        : rest.price;
  const nextStock =
    variantModel === 'sku_matrix'
      ? (defaultSelection?.variant.stock_quantity ?? 0)
      : has_variants
        ? getTotalVariantStock(variants)
        : rest.stock_quantity;
  const nextCondition =
    variantModel === 'sku_matrix'
      ? (defaultSelection?.condition ?? persistedVariants[0]?.condition ?? null)
      : (rest.condition ?? null);
  const normalizedParentColor = rest.color?.trim() || null;
  const projectedVariantMedia = has_variants
    ? resolveProductVariantMedia({
        productColors: normalizedParentColor
          ? [normalizedParentColor]
          : undefined,
        productImages: rest.images,
        variants: persistedVariants.map((variant) => ({
          attributes: variant.attributes,
          images: variant.images,
          primary_image: variant.primary_image,
        })),
      })
    : null;
  const nextColor = has_variants
    ? (projectedVariantMedia?.colors?.[0] ?? normalizedParentColor)
    : normalizedParentColor;

  return {
    ...rest,
    category_id: rest.category_id === '' ? null : rest.category_id,
    color: nextColor,
    condition: nextCondition,
    has_variants,
    manage_stock: rest.manage_stock,
    price: nextPrice,
    sku: rest.sku.trim() || null,
    stock: nextStock,
    stock_quantity: nextStock,
    variant_model: variantModel,
    ...(variantModel === 'sku_matrix'
      ? { migration_status: 'migrated' as const }
      : {}),
    variant_attributes: has_variants
      ? buildParentVariantAttributes(variants)
      : attributesRecord,
    variants: persistedVariants,
  };
}
