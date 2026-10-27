import { prepareJumiaListingContent } from './listing-content';
import type { JumiaCanonicalPreflightInput } from './prepare-product-feed-types';

export type AddPreflightError = (
  field: string,
  code: string,
  variantId?: string
) => void;

export function checkJumiaPreflightContent(
  input: JumiaCanonicalPreflightInput,
  add: AddPreflightError
) {
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
  for (const attribute of mapping.attributes.filter((item) =>
    ['weight', 'product_weight', 'package_weight'].includes(
      item.name.trim().toLowerCase()
    )
  ))
    add(
      `mapping.attributes.${attribute.code}`,
      'weight_attribute_serialization_unsupported'
    );

  return { contentResult, price };
}
