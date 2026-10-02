import { productDiscoveryMetadataSchema } from '@/schemas/product-discovery-metadata';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Proposals require evidence review. No descriptions, titles or option facts are mined. */
export function proposeDiscoveryFacts(input: {
  category: string | null;
  metadata: unknown;
  discovery_metadata: unknown;
}) {
  const source = object(input.metadata);
  const existing = productDiscoveryMetadataSchema.safeParse(
    input.discovery_metadata ?? {}
  );
  const warnings: string[] = [];
  if (!existing.success)
    warnings.push('Existing facts are invalid. Repair them before saving.');
  const draft = existing.success
    ? { ...existing.data }
    : structuredClone(object(input.discovery_metadata));
  const categoryTypes: Record<string, string> = {
    Smartphones: 'phone',
    Laptops: 'laptop',
    Tablets: 'tablet',
  };
  const explicitType =
    typeof source.type === 'string' ? source.type : undefined;
  const categoryType =
    input.category && Object.hasOwn(categoryTypes, input.category)
      ? categoryTypes[input.category]
      : undefined;
  if (!draft.product_type && categoryType) draft.product_type = categoryType;
  if (!draft.product_type && explicitType) {
    const parsed = productDiscoveryMetadataSchema.safeParse({
      product_type: explicitType,
    });
    if (parsed.success) draft.product_type = parsed.data.product_type;
  }
  // A manufacturer's model list or MPN is not necessarily the shopper-facing identity.
  const model = typeof source.model === 'string' ? source.model : undefined;
  const canonical =
    typeof source.canonical_model === 'string'
      ? source.canonical_model
      : undefined;
  if (model && canonical && model !== canonical) {
    warnings.push(
      'Stored model identities disagree; confirm the correct identity.'
    );
  } else if (!draft.model && (model || canonical)) {
    const parsed = productDiscoveryMetadataSchema.safeParse({
      model: model || canonical,
    });
    if (parsed.success) draft.model = parsed.data.model;
  }
  if (explicitType && categoryType)
    warnings.push('Check that the stored type agrees with the category.');
  return {
    draft,
    warnings,
    existingValid: existing.success,
    evidence: {
      category: input.category,
      type: explicitType ?? null,
      model: model ?? null,
      canonical_model: canonical ?? null,
      source_urls: source.source_urls ?? source.official_sources ?? null,
    },
  };
}
