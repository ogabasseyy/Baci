const COMMERCE_VARIANT_AXIS_ALIASES: Record<string, string> = {
  colour: 'color',
  gpu: 'graphics',
  ram_options: 'ram',
  storage_capacity: 'storage',
};

/**
 * Descriptive / display-only metadata and operational identifiers that must
 * never become a purchase axis. Merchant-defined SKU dimensions outside the
 * historical allowlist (material, style, flavor, …) stay selectable.
 */
const NON_COMMERCE_VARIANT_AXIS_METADATA = new Set([
  'availability',
  'availability_note',
  'camera',
  'color_hex',
  'colorhex',
  'colour_hex',
  'colourhex',
  'delivery_notice',
  'disclaimer',
  'disclaimers',
  'display_size',
  'display_type',
  'id',
  'image',
  'images',
  'keyboard',
  'model',
  'model_number',
  'note',
  'notes',
  'notice',
  'operating_system',
  'price',
  'product_id',
  'screen_size',
  'sku',
  'slug',
  'variant_id',
  'variant_name',
  'warranty_note',
  'wireless',
]);

function normalizeAxisKey(axis: string) {
  return axis
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');
}

function isNonCommerceVariantAxis(canonical: string): boolean {
  if (NON_COMMERCE_VARIANT_AXIS_METADATA.has(canonical)) {
    return true;
  }

  // Nested specification dumps flatten to specs_* and are never purchase axes.
  return canonical === 'specs' || canonical.startsWith('specs_');
}

export function canonicalizeCommerceVariantAxis(axis: string): string | null {
  const normalized = normalizeAxisKey(axis);
  if (!normalized) {
    return null;
  }

  const canonical = COMMERCE_VARIANT_AXIS_ALIASES[normalized] ?? normalized;
  return isNonCommerceVariantAxis(canonical) ? null : canonical;
}
