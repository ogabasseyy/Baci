import { getEffectiveStock } from '@/lib/product-stock';
import {
  type JumiaCreateProduct,
  JumiaCreateProductSchema,
} from '@/schemas/jumia/create-product';
import { validateJumiaAttributeValueSet } from './attribute-value-set';
import type { JumiaDraftValue } from './attribute-values';
import type { JumiaPreparedContent } from './listing-content';
import type { AddPreflightError } from './prepare-product-feed-content-checks';
import type {
  CanonicalImage,
  CanonicalVariant,
  JumiaCanonicalPreflightInput,
} from './prepare-product-feed-types';
import {
  serializeAttributeValue,
  serializeVariationValue,
  type VariationValue,
} from './prepare-product-feed-values';

export type JumiaProductFeedRecordContext = {
  content: JumiaPreparedContent | null;
  price: { currency: string; value: number } | null;
  orderedVariants: CanonicalVariant[];
  variationAttribute:
    | JumiaCanonicalPreflightInput['mapping']['attributes'][number]
    | undefined;
  variationValuesByVariant: Map<string, VariationValue>;
  chosenImages: (CanonicalImage | undefined)[];
};

export function buildJumiaProductFamilyRecords(
  input: JumiaCanonicalPreflightInput,
  context: JumiaProductFeedRecordContext,
  add: AddPreflightError,
  hasErrors: () => boolean
): JumiaCreateProduct[] {
  const { source, destination, mapping } = input;
  const product = source.product;
  const { content, price, orderedVariants, variationAttribute } = context;
  const orderedRecords = orderedVariants.length ? orderedVariants : [null];
  const familyRecords: JumiaCreateProduct[] = [];
  const parentSku = orderedVariants[0]?.sku ?? product.sku ?? '';
  const normalizedImages = context.chosenImages.flatMap((image) =>
    image?.verifiedUrl
      ? [{ url: image.verifiedUrl, primary: image.isPrimary }]
      : []
  );

  for (const variant of orderedRecords) {
    const sku = variant?.sku ?? product.sku;
    const variantId = variant?.id;
    if (typeof sku !== 'string' || !sku.trim()) {
      add(
        variantId ? `source.variants.${variantId}.sku` : 'source.product.sku',
        'seller_sku_missing',
        variantId
      );
      continue;
    }
    if (!content) continue;
    const policy = variant
      ? variant.inventoryTrackingPolicy
      : product.inventoryTrackingPolicy;
    if (
      product.manageStock !== true ||
      product.inventoryTrackingPolicy !== 'off' ||
      !['off', 'inherit'].includes(policy ?? '')
    ) {
      add(
        'source.inventoryTrackingPolicy',
        'managed_stock_unproven',
        variantId
      );
      continue;
    }
    if (
      !variant &&
      [product.stock, product.stockQuantity].some(
        (stock) => stock !== null && (!Number.isSafeInteger(stock) || stock < 0)
      )
    ) {
      add('source.stock', 'finite_managed_stock_required');
      continue;
    }
    const effectiveStock = variant
      ? variant.stockQuantity
      : getEffectiveStock({
          stock: product.stock,
          stock_quantity: product.stockQuantity,
        });
    const effectivePrice = variant?.priceOverride ?? product.price;
    if (
      typeof effectiveStock !== 'number' ||
      !Number.isSafeInteger(effectiveStock) ||
      effectiveStock < 0
    ) {
      add('source.stock', 'finite_managed_stock_required', variantId);
      continue;
    }
    if (!variant && product.stockQuantity === null && product.stock === null) {
      add('source.stock', 'finite_managed_stock_required');
      continue;
    }
    if (
      variant &&
      (!Number.isSafeInteger(variant.stockQuantity) ||
        variant.stockQuantity === null ||
        variant.stockQuantity < 0)
    ) {
      add('source.stock', 'finite_managed_stock_required', variantId);
      continue;
    }
    if (
      typeof effectivePrice !== 'number' ||
      !Number.isFinite(effectivePrice) ||
      effectivePrice <= 0
    ) {
      add('source.price', 'canonical_price_invalid', variantId);
      continue;
    }
    const generatedValues: Record<string, JumiaDraftValue | undefined> = {
      ...mapping.values,
    };
    const byName = new Map(
      mapping.attributes.map((attribute) => [
        attribute.name.trim().toLowerCase(),
        attribute,
      ])
    );
    const generated = new Map<string, JumiaDraftValue>([
      ['name', content.name.value],
      ['description', content.description.value],
      ['short_description', content.shortDescriptionHtml],
    ]);
    const variationValue =
      variant && variationAttribute
        ? context.variationValuesByVariant.get(variant.id)
        : variationAttribute
          ? serializeVariationValue(variationAttribute, '...')
          : null;
    const currentVariation = variationValue?.wireValue ?? '...';
    if (variationAttribute)
      generated.set(
        variationAttribute.name.trim().toLowerCase(),
        variationValue?.draftValue ?? currentVariation
      );
    for (const [name, value] of generated) {
      const attribute = byName.get(name);
      if (!attribute) continue;
      const code = String(attribute.code);
      const supplied = generatedValues[code];
      const wireValue =
        name === variationAttribute?.name.trim().toLowerCase()
          ? currentVariation
          : String(value);
      const suppliedWireValue =
        supplied === undefined
          ? undefined
          : serializeAttributeValue(attribute, supplied);
      if (
        supplied !== undefined &&
        (suppliedWireValue === null || suppliedWireValue !== wireValue)
      )
        add(`mapping.values.${code}`, 'special_attribute_conflict', variantId);
      generatedValues[code] = value;
    }
    const validated = validateJumiaAttributeValueSet(
      mapping.attributes,
      generatedValues
    );
    if (!validated.success) {
      for (const error of validated.errors)
        add(`mapping.${error.field}`, 'attribute_value_invalid', variantId);
      continue;
    }
    const attributes = mapping.attributes.flatMap((definition) => {
      const value = validated.values[String(definition.code)];
      if (value === undefined) return [];
      const wireValue = serializeAttributeValue(definition, value);
      if (definition.type === 3) {
        add(
          `mapping.values.${definition.code}`,
          'multi_select_serialization_unsupported',
          variantId
        );
        return [];
      }
      if (wireValue === null) {
        add(
          `mapping.values.${definition.code}`,
          'attribute_serialization_unsupported',
          variantId
        );
        return [];
      }
      return [{ name: definition.name, value: wireValue }];
    });
    if (hasErrors()) continue;
    if (!price) continue;
    const candidate = {
      name: content.name,
      description: content.description,
      parentSku,
      sellerSku: sku,
      variation: currentVariation,
      brand: { code: mapping.brand.code, name: mapping.brand.name },
      category: { code: mapping.category.code, name: mapping.category.name },
      images: normalizedImages,
      price: { currency: price.currency, value: price.value },
      businessClients: [
        {
          businessClientCode: destination.businessClientCode,
          price: { currency: destination.localCurrency, value: effectivePrice },
        },
      ],
      stock: effectiveStock,
      attributes,
    };
    const parsed = JumiaCreateProductSchema.safeParse(candidate);
    if (!parsed.success) {
      add('preparedProduct', 'create_product_contract_invalid', variantId);
      continue;
    }
    familyRecords.push(parsed.data);
  }
  return familyRecords;
}
