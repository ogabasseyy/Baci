/**
 * Canonical variant axes that are display-only metadata, swatches, or informational notes,
 * and should not be rendered as selectable attribute buttons in variant pickers.
 */
const SWATCH_ONLY_VARIANT_AXES = new Set([
  'color',
  'colour',
  'color_hex',
  'colour_hex',
]);

const DISPLAY_ONLY_METADATA_AXES = new Set([
  'availability_note',
  'availability',
  'note',
  'notes',
  'disclaimer',
  'disclaimers',
  'warranty_note',
  'delivery_notice',
  'notice',
]);

/**
 * Informational metadata axes that must never block checkout even when variants differ.
 */
export function isDisplayOnlyVariantAxis(axis: string): boolean {
  return DISPLAY_ONLY_METADATA_AXES.has(axis);
}

/**
 * Determines whether a variant axis should be rendered as an interactive picker.
 * A selector is useful only when the customer can choose between multiple values.
 */
export function isRenderableVariantAxis(
  axis: string,
  optionCount: number
): boolean {
  if (
    !axis ||
    SWATCH_ONLY_VARIANT_AXES.has(axis) ||
    DISPLAY_ONLY_METADATA_AXES.has(axis)
  ) {
    return false;
  }

  return optionCount > 1;
}
