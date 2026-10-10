const LEADING_NON_RENDERING_PATTERN =
  /^[\p{White_Space}\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]*/u;

/**
 * Strips whitespace and Unicode default-ignorable / invisible formatting
 * characters from the start of a string so shape detection (e.g. JSON vs
 * HTML) sees the first character a reader would actually encounter.
 */
export function stripLeadingNonRenderingText(value: string): string {
  return value.replace(LEADING_NON_RENDERING_PATTERN, '');
}
