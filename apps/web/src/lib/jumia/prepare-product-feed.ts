import { getEffectiveStock } from '@/lib/product-stock';
import type { JumiaAttributeSetResponse } from '@/schemas/jumia/catalog';
import {
  type JumiaCreateProduct,
  JumiaCreateProductSchema,
} from '@/schemas/jumia/create-product';
import { validateJumiaAttributeValueSet } from './attribute-value-set';
import type { JumiaDraftValue } from './attribute-values';
import {
  type JumiaDraftAttribute,
  validateAttributeValue,
} from './attribute-values';
import { prepareJumiaListingContent } from './listing-content';

type CanonicalProduct = {
  id: string;
  merchantId: string;
  status: string;
  hasVariants: boolean | null;
  variantModel: string | null;
  updatedAt: string;
  name: string | null;
  description: string | null;
  sku: string | null;
  exportImages: unknown;
  price: number | null;
  stock: number | null;
  stockQuantity: number | null;
  manageStock: boolean | null;
  inventoryTrackingPolicy: string | null;
  inventoryAnchorVariantId: string | null;
  condition: string | null;
  weightValue: number | null;
  weightUnit: string | null;
  categoryId: string | null;
};

type CanonicalVariant = {
  id: string;
  attributes: Record<string, unknown>;
  sku: string | null;
  priceOverride: number | null;
  stockQuantity: number | null;
  inventoryTrackingPolicy: string | null;
  condition: string | null;
  updatedAt: string;
  isInventoryAnchor: boolean;
};

type CanonicalImage = {
  id: string;
  variantId: string | null;
  status: string;
  verifiedUrl: string | null;
  verifiedFormat: string | null;
  isPrimary: boolean;
  position: number;
  verifiedAt: string | null;
  updatedAt: string;
};

export type JumiaCanonicalPreflightInput = {
  merchantId: string;
  selectionId: string;
  sourceCategoryId: string;
  sourceVersion: string;
  source: {
    contractVersion: 1;
    product: CanonicalProduct;
    categoryMemberships: { id: string; name: string; isActive: boolean }[];
    variants: CanonicalVariant[];
    images: CanonicalImage[];
  };
  destination: {
    shopId: string;
    businessClientCode: string;
    countryCode: string;
    localCurrency: string;
  };
  mapping: {
    category: {
      code: number;
      name: string;
      attributeSetId: string;
      activeLeaf: boolean;
      availableForDestination: boolean;
    };
    brand: { code: number; name: string; availableForDestination: boolean };
    attributes: JumiaAttributeSetResponse['attributes'];
    values: Record<string, JumiaDraftValue | undefined>;
    categoryConfirmed: boolean;
    bullets: string[];
    variation?: { sourceAttributeName: string };
  };
  evidence: {
    providerClassification: '3c' | 'non-3c' | 'unknown';
    globalPrice: { currency: string; value: number } | null;
    images: Record<
      string,
      {
        publiclyReachable: boolean;
        byteSize: number | null;
        width: number | null;
        height: number | null;
        qualityAccepted: boolean;
      }
    >;
  };
};

export type JumiaCanonicalPreflightError = {
  productId: string;
  variantId?: string;
  field: string;
  code: string;
};

export type JumiaCanonicalPreflightResult =
  | { success: false; products: []; errors: JumiaCanonicalPreflightError[] }
  | {
      success: true;
      products: JumiaCreateProduct[];
      families: {
        familyKey: string;
        businessClientCode: string;
        categoryCode: number;
        attributeSetId: string;
        records: JumiaCreateProduct[];
      }[];
      evidenceBoundaries: string[];
    };

type VariationValue = { draftValue: JumiaDraftValue; wireValue: string };

function isHttpImageUrl(value: string | null): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function stableSourceValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableSourceValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stableSourceValue(entry)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function serializeVariationValue(
  attribute: JumiaAttributeSetResponse['attributes'][number],
  raw: unknown
): VariationValue | null {
  if (attribute.type === 0 || attribute.type === 1) {
    return typeof raw === 'string' &&
      validateAttributeValue(attribute as JumiaDraftAttribute, raw) === null
      ? { draftValue: raw, wireValue: raw }
      : null;
  }
  if (attribute.type === 2 || attribute.type === 8) {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim()
          ? Number(raw)
          : Number.NaN;
    return Number.isFinite(value) &&
      validateAttributeValue(attribute as JumiaDraftAttribute, value) === null
      ? { draftValue: value, wireValue: String(value) }
      : null;
  }
  if (attribute.type === 4 && typeof raw === 'string') {
    const options =
      attribute.options?.filter(
        (option) => option.status === 'ACTIVE' && option.name === raw
      ) ?? [];
    return options.length === 1
      ? { draftValue: options[0].id, wireValue: options[0].name }
      : null;
  }
  if (attribute.type === 6) {
    const value =
      typeof raw === 'boolean'
        ? raw
        : raw === 'true'
          ? true
          : raw === 'false'
            ? false
            : undefined;
    return value !== undefined
      ? { draftValue: value, wireValue: String(value) }
      : null;
  }
  if (
    (attribute.type === 5 || attribute.type === 7) &&
    typeof raw === 'string'
  ) {
    return validateAttributeValue(attribute as JumiaDraftAttribute, raw) ===
      null
      ? { draftValue: raw, wireValue: raw }
      : null;
  }
  return null;
}

function serializeAttributeValue(
  definition: JumiaAttributeSetResponse['attributes'][number],
  value: JumiaDraftValue
): string | null {
  if (
    (definition.type === 0 ||
      definition.type === 1 ||
      definition.type === 5 ||
      definition.type === 7) &&
    typeof value === 'string'
  )
    return value;
  if (
    (definition.type === 2 || definition.type === 8) &&
    typeof value === 'number'
  )
    return String(value);
  if (definition.type === 6 && typeof value === 'boolean') return String(value);
  if (definition.type === 4 && typeof value === 'number') {
    // The official Create Products example resolves one option to its exact
    // name. The docs do not describe a combined multi-selection value.
    const options =
      definition.options?.filter(
        (option) => option.id === value && option.status === 'ACTIVE'
      ) ?? [];
    return options.length === 1 ? options[0].name : null;
  }
  return null;
}

export function prepareJumiaProductFeed(
  input: JumiaCanonicalPreflightInput
): JumiaCanonicalPreflightResult {
  const errors: JumiaCanonicalPreflightError[] = [];
  const productId = input.source.product.id;
  const add = (field: string, code: string, variantId?: string) => {
    if (
      !errors.some(
        (error) =>
          error.field === field &&
          error.code === code &&
          error.variantId === variantId
      )
    )
      errors.push({
        productId,
        ...(variantId ? { variantId } : {}),
        field,
        code,
      });
  };
  const failure = (): JumiaCanonicalPreflightResult => ({
    success: false,
    products: [],
    errors: [...errors].sort((left, right) => {
      const leftKey = `${left.productId}\0${left.variantId ?? ''}\0${left.field}\0${left.code}`;
      const rightKey = `${right.productId}\0${right.variantId ?? ''}\0${right.field}\0${right.code}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  });
  const { source, destination, mapping, evidence } = input;
  const product = source.product;

  if (source.contractVersion !== 1)
    add('source.contractVersion', 'unsupported_projection');
  if (product.merchantId !== input.merchantId)
    add('source.product.merchantId', 'merchant_mismatch');
  if (product.status !== 'active')
    add('source.product.status', 'product_inactive');
  if (product.hasVariants === null)
    add('source.product.hasVariants', 'variant_model_unknown');
  if (
    !source.categoryMemberships.some(
      (membership) =>
        membership.id === input.sourceCategoryId && membership.isActive
    )
  )
    add('source.categoryMemberships', 'source_category_membership_unproven');
  if (
    destination.countryCode !== 'NG' ||
    destination.localCurrency !== 'NGN' ||
    !destination.businessClientCode
  )
    add('destination', 'unsupported_destination');
  if (!mapping.categoryConfirmed)
    add('mapping.categoryConfirmed', 'category_confirmation_required');
  if (
    !mapping.category.activeLeaf ||
    !mapping.category.availableForDestination ||
    mapping.category.attributeSetId.length === 0
  )
    add('mapping.category', 'category_evidence_incomplete');
  if (!mapping.brand.availableForDestination)
    add('mapping.brand', 'brand_availability_unproven');
  if (!mapping.category.attributeSetId)
    add('mapping.category.attributeSetId', 'attribute_set_unavailable');
  if (
    !Number.isSafeInteger(mapping.category.code) ||
    mapping.category.code <= 0
  )
    add('mapping.category.code', 'category_code_invalid');
  if (!mapping.category.name.trim())
    add('mapping.category.name', 'category_name_missing');
  if (!Number.isSafeInteger(mapping.brand.code) || mapping.brand.code <= 0)
    add('mapping.brand.code', 'brand_code_invalid');
  if (!mapping.brand.name.trim())
    add('mapping.brand.name', 'brand_name_missing');

  const price = evidence.globalPrice;
  if (
    !price?.currency.trim() ||
    !Number.isFinite(price.value) ||
    price.value <= 0
  )
    add('evidence.globalPrice', 'global_price_unproven');
  if (price && price.currency !== price.currency.trim())
    add('evidence.globalPrice.currency', 'global_currency_invalid');
  if (
    evidence.providerClassification !== '3c' &&
    evidence.providerClassification !== 'non-3c'
  )
    add('evidence.providerClassification', 'classification_unproven');
  const contentResult = prepareJumiaListingContent({
    title: product.name,
    description: product.description,
    bullets: mapping.bullets,
    providerClassification: evidence.providerClassification,
    weight: { value: product.weightValue, unit: product.weightUnit },
  });
  if (!contentResult.success) {
    for (const error of contentResult.errors)
      add(`source.product.${error.field}`, 'content_invalid');
  } else if (
    contentResult.classificationBoundary !== 'explicit-provider-classification'
  ) {
    add('evidence.providerClassification', 'classification_unproven');
  }

  const attributeNames = mapping.attributes.map((attribute) =>
    attribute.name.trim().toLowerCase()
  );
  if (new Set(attributeNames).size !== attributeNames.length)
    add('mapping.attributes', 'attribute_names_ambiguous');
  const weightAttributes = mapping.attributes.filter((attribute) =>
    ['weight', 'product_weight', 'package_weight'].includes(
      attribute.name.trim().toLowerCase()
    )
  );
  for (const attribute of weightAttributes)
    add(
      `mapping.attributes.${attribute.code}`,
      'weight_attribute_serialization_unsupported'
    );

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

  const imagesByVariant = new Map<string | null, CanonicalImage[]>();
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
  const variantImageSets = orderedVariants.map((variant) => {
    const ids = [
      ...(imagesByVariant.get(null) ?? []),
      ...(imagesByVariant.get(variant.id) ?? []),
    ]
      .map((image) => image.id)
      .sort();
    return ids;
  });
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

  // Validate local source stock/prices and ordinary mapping values before the
  // external-evidence gate. A preview must not hide actionable local defects
  // merely because the trusted global price/classification evidence is absent.
  const preflightVariants: (CanonicalVariant | null)[] = orderedVariants.length
    ? orderedVariants
    : [null];
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

  const content = contentResult.success ? contentResult.content : null;
  const orderedRecords = orderedVariants.length ? orderedVariants : [null];
  const familyRecords: JumiaCreateProduct[] = [];
  const familyKey = `${input.selectionId}:${productId}`;
  const parentSku = orderedVariants[0]?.sku ?? product.sku ?? '';
  const normalizedImages = chosenImages.flatMap((image) =>
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
        attribute.name.toLowerCase(),
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
        ? variationValuesByVariant.get(variant.id)
        : variationAttribute
          ? serializeVariationValue(variationAttribute, '...')
          : null;
    const currentVariation = variationValue?.wireValue ?? '...';
    if (variationAttribute)
      generated.set(
        variationAttribute.name.toLowerCase(),
        variationValue?.draftValue ?? currentVariation
      );
    for (const [name, value] of generated) {
      const attribute = byName.get(name);
      if (!attribute) continue;
      const code = String(attribute.code);
      const supplied = generatedValues[code];
      const wireValue =
        name === variationAttribute?.name.toLowerCase()
          ? currentVariation
          : String(value);
      const suppliedWireValue =
        supplied === undefined || !attribute
          ? undefined
          : serializeAttributeValue(attribute, supplied);
      if (
        supplied !== undefined &&
        (suppliedWireValue === null || suppliedWireValue !== wireValue)
      ) {
        add(`mapping.values.${code}`, 'special_attribute_conflict', variantId);
      }
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
    if (errors.length) continue;
    if (!content || !price) continue;
    const localPrice = effectivePrice;
    const candidate = {
      name: content.name,
      description: content.description,
      parentSku: parentSku,
      sellerSku: sku,
      variation: currentVariation,
      brand: { code: mapping.brand.code, name: mapping.brand.name },
      category: { code: mapping.category.code, name: mapping.category.name },
      images: normalizedImages,
      price: { currency: price.currency, value: price.value },
      businessClients: [
        {
          businessClientCode: destination.businessClientCode,
          price: { currency: destination.localCurrency, value: localPrice },
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
  if (errors.length || familyRecords.length !== orderedRecords.length)
    return failure();
  const skuSet = new Set<string>();
  for (const record of familyRecords) {
    if (skuSet.has(record.sellerSku))
      add(`source.sku.${record.sellerSku}`, 'duplicate_seller_sku');
    skuSet.add(record.sellerSku);
  }
  if (errors.length) return failure();
  return {
    success: true,
    products: structuredClone(familyRecords),
    families: [
      {
        familyKey,
        businessClientCode: destination.businessClientCode,
        categoryCode: mapping.category.code,
        attributeSetId: mapping.category.attributeSetId,
        records: structuredClone(familyRecords),
      },
    ],
    evidenceBoundaries: [
      'Local canonical validation only; not provider acceptance or permission to submit.',
      'Global price and image quality evidence must be independently established by the authorized server loader.',
    ],
  };
}
