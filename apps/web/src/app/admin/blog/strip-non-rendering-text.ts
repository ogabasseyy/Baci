// Default-ignorable marks (U+034F, variation selectors, ...) render nothing
// but are category Mn rather than Cf/Cc, so the general Unicode property
// carries them while Cc stays explicit.
const NON_RENDERING_TEXT_PATTERN = /[\p{Cc}\p{Default_Ignorable_Code_Point}]/gu;

export function stripNonRenderingText(value: string): string {
  return value.replace(NON_RENDERING_TEXT_PATTERN, '');
}
