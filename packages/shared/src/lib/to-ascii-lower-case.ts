/** Locale-free ASCII case folding for values mirrored across the JS/SQL
 * boundary. Full Unicode lowering diverges: JavaScript applies contextual
 * casing (Greek final sigma) and locale rules (Turkish dotted I) that
 * PostgreSQL's locale-dependent lower() does not share, so digests and
 * comparisons derived after full lowering disagree across sides and strand
 * exact matches. Non-ASCII codepoints stay case-sensitive by design; ASCII
 * behavior is identical to toLowerCase(). SQL mirrors with translate(). */
export function toAsciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
