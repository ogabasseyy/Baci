import { getEffectiveStock } from '@/lib/product-stock';
import type { JumiaAttributeSetResponse } from '@/schemas/jumia/catalog';
import { validateJumiaAttributeValueSet } from './attribute-value-set';
import type { AddPreflightError } from './prepare-product-feed-content-checks';
import type { JumiaCanonicalPreflightInput } from './prepare-product-feed-types';
import {
  isHttpImageUrl,
  serializeVariationValue,
  stableSourceValue,
  type VariationValue,
} from './prepare-product-feed-values';

export function checkJumiaPreflightSource(
  input: JumiaCanonicalPreflightInput,
  add: AddPreflightError
) {
  const { source, mapping, evidence } = input;
  const product = source.product;
  const sellableVariants = source.variants.filter(
    (variant) => !variant.isInventoryAnchor
  );
  const anchors = source.variants.filter(
    (variant) => variant.isInventoryAnchor
  );
  if (
    anchors.length > 1 ||
    (anchors.length === 1 &&
      product.inventoryAnchorVariantId !== anchors[0].id) ||
    (anchors.length === 0 && product.inventoryAnchorVariantId !== null)
  )
    add('source.inventoryAnchorVariantId', 'anchor_evidence_inconsistent');
  if (product.hasVariants === false && sellableVariants.length > 0)
    add('source.variants', 'variant_model_inconsistent');
  if (product.hasVariants === true && source.variants.length === 0)
    add('source.variants', 'variant_source_missing');

  const variantAxis = mapping.attributes.filter(
    (attribute) => attribute.variation
  );
  if (sellableVariants.length > 0 && variantAxis.length !== 1)
    add('mapping.attributes', 'variation_axis_ambiguous');
  const variationAttribute = variantAxis[0];
  const forbiddenVariationNames = new Set([
    'color',
    'colour',
    'shape',
    'condition',
  ]);
  if (
    variationAttribute &&
    forbiddenVariationNames.has(variationAttribute.name.trim().toLowerCase())
  )
    add(
      `mapping.attributes.${variationAttribute.code}`,
      'variation_group_unsupported'
    );
  if (sellableVariants.length > 0 && !mapping.variation?.sourceAttributeName)
    add('mapping.variation', 'variation_source_mapping_required');

  const orderedVariants = [...sellableVariants].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
  if (orderedVariants.length > 1) {
    const first = orderedVariants[0];
    for (const sibling of orderedVariants.slice(1)) {
      if (sibling.condition !== first.condition)
        add(
          'source.variants.condition',
          'variant_condition_difference_unsupported',
          sibling.id
        );
      const attributeNames = new Set([
        ...Object.keys(first.attributes),
        ...Object.keys(sibling.attributes),
      ]);
      for (const name of attributeNames) {
        if (
          name === mapping.variation?.sourceAttributeName.trim() ||
          stableSourceValue(first.attributes[name]) ===
            stableSourceValue(sibling.attributes[name])
        )
          continue;
        add(
          `source.variants.attributes.${name}`,
          'variant_attribute_difference_unsupported',
          sibling.id
        );
      }
    }
  }
  const sourceSkus = new Set<string>();
  for (const variant of orderedVariants) {
    if (!variant.sku?.trim())
      add('source.variants.sku', 'seller_sku_missing', variant.id);
    else if (sourceSkus.has(variant.sku))
      add('source.variants.sku', 'duplicate_seller_sku', variant.id);
    else sourceSkus.add(variant.sku);
  }
  if (!orderedVariants.length && !product.sku?.trim())
    add('source.product.sku', 'seller_sku_missing');
  const selectedVariantValues = new Map<string, string>();
  const variationValuesByVariant = new Map<string, VariationValue>();
  if (variationAttribute && mapping.variation?.sourceAttributeName) {
    for (const variant of orderedVariants) {
      const raw = variant.attributes[mapping.variation.sourceAttributeName];
      const serialized = serializeVariationValue(variationAttribute, raw);
      if (!serialized) {
        add(
          `source.variants.${mapping.variation.sourceAttributeName}`,
          'variation_value_invalid',
          variant.id
        );
        continue;
      }
      const value = serialized.wireValue;
      if (selectedVariantValues.has(value))
        add(
          `source.variants.${mapping.variation.sourceAttributeName}`,
          'variation_value_not_distinct',
          variant.id
        );
      selectedVariantValues.set(value, variant.id);
      variationValuesByVariant.set(variant.id, serialized);
      if (
        variationAttribute.type === 3 ||
        ![0, 1, 2, 4, 5, 6, 7, 8].includes(variationAttribute.type)
      )
        add(
          `mapping.attributes.${variationAttribute.code}`,
          'variation_type_unsupported',
          variant.id
        );
    }
  }

  const imagesByVariant = new Map<string | null, typeof source.images>();
  const sourceVariantIds = new Set(
    source.variants.map((variant) => variant.id)
  );
  for (const image of source.images) {
    if (image.variantId && !sourceVariantIds.has(image.variantId))
      add(`source.images.${image.id}`, 'image_variant_unresolved');
    const list = imagesByVariant.get(image.variantId) ?? [];
    list.push(image);
    imagesByVariant.set(image.variantId, list);
  }
  const variantImageSets = orderedVariants.map((variant) =>
    [
      ...(imagesByVariant.get(null) ?? []),
      ...(imagesByVariant.get(variant.id) ?? []),
    ]
      .map((image) => image.id)
      .sort()
  );
  const fallbackImageSet = (imagesByVariant.get(null) ?? [])
    .map((image) => image.id)
    .sort();
  const imageSet = variantImageSets[0] ?? fallbackImageSet;
  if (
    variantImageSets.some(
      (set) => JSON.stringify(set) !== JSON.stringify(imageSet)
    )
  )
    add('source.images', 'image_sibling_set_mismatch');
  if (imageSet.length < 1 || imageSet.length > 8)
    add('source.images', 'image_count_out_of_range');
  const chosenImages = imageSet.map((id) =>
    source.images.find((image) => image.id === id)
  );
  if (
    chosenImages.some(
      (image) =>
        image?.status !== 'verified' ||
        !isHttpImageUrl(image.verifiedUrl) ||
        !image.verifiedFormat
    )
  )
    add('source.images', 'verified_image_source_missing');
  if (chosenImages.filter((image) => image?.isPrimary).length !== 1)
    add('source.images', 'primary_image_invalid');
  for (const image of chosenImages) {
    if (!image) continue;
    const facts = evidence.images[image.id];
    if (
      !facts?.publiclyReachable ||
      !facts.qualityAccepted ||
      !Number.isSafeInteger(facts.byteSize) ||
      !facts.byteSize ||
      facts.byteSize < 1 ||
      !Number.isSafeInteger(facts.width) ||
      !facts.width ||
      facts.width < 1 ||
      !Number.isSafeInteger(facts.height) ||
      !facts.height ||
      facts.height < 1
    )
      add(`evidence.images.${image.id}`, 'image_evidence_incomplete');
  }

  const preflightVariants = orderedVariants.length ? orderedVariants : [null];
  for (const variant of preflightVariants) {
    const variantId = variant?.id;
    const policy = variant
      ? variant.inventoryTrackingPolicy
      : product.inventoryTrackingPolicy;
    if (
      product.manageStock !== true ||
      product.inventoryTrackingPolicy !== 'off' ||
      !['off', 'inherit'].includes(policy ?? '')
    )
      add(
        'source.inventoryTrackingPolicy',
        'managed_stock_unproven',
        variantId
      );
    const stock = variant
      ? variant.stockQuantity
      : getEffectiveStock({
          stock: product.stock,
          stock_quantity: product.stockQuantity,
        });
    if (typeof stock !== 'number' || !Number.isSafeInteger(stock) || stock < 0)
      add('source.stock', 'finite_managed_stock_required', variantId);
    if (
      !variant &&
      [product.stock, product.stockQuantity].some(
        (rawStock) =>
          rawStock !== null && (!Number.isSafeInteger(rawStock) || rawStock < 0)
      )
    )
      add('source.stock', 'finite_managed_stock_required');
    if (!variant && product.stockQuantity === null && product.stock === null)
      add('source.stock', 'finite_managed_stock_required');
    const canonicalPrice = variant?.priceOverride ?? product.price;
    if (
      typeof canonicalPrice !== 'number' ||
      !Number.isFinite(canonicalPrice) ||
      canonicalPrice <= 0
    )
      add('source.price', 'canonical_price_invalid', variantId);
  }

  const generatedAttributeNames = new Set([
    'name',
    'description',
    'short_description',
    variationAttribute?.name.trim().toLowerCase(),
  ]);
  const independentlyValidatableAttributes = mapping.attributes.filter(
    (attribute) =>
      !generatedAttributeNames.has(attribute.name.trim().toLowerCase())
  );
  if (independentlyValidatableAttributes.length) {
    const generatedAttributeCodes = new Set(
      mapping.attributes
        .filter((attribute) =>
          generatedAttributeNames.has(attribute.name.trim().toLowerCase())
        )
        .map((attribute) => String(attribute.code))
    );
    const independentlySuppliedValues = Object.fromEntries(
      Object.entries(mapping.values).filter(
        ([code]) => !generatedAttributeCodes.has(code)
      )
    );
    const independentlyValidated = validateJumiaAttributeValueSet(
      independentlyValidatableAttributes,
      independentlySuppliedValues
    );
    if (!independentlyValidated.success) {
      for (const variant of preflightVariants)
        for (const error of independentlyValidated.errors)
          add(`mapping.${error.field}`, 'attribute_value_invalid', variant?.id);
    }
  }

  return {
    orderedVariants,
    variationAttribute: variationAttribute as
      | JumiaAttributeSetResponse['attributes'][number]
      | undefined,
    variationValuesByVariant,
    chosenImages,
  };
}
