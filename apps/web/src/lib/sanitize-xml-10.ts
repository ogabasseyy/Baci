function isXml10CharCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

// Numeric character references, with or without the semicolon (HTML parsers
// decode both forms). Only references that decode to XML-forbidden code
// points are removed; valid ones like &#241; pass through untouched.
const FORBIDDEN_XML10_ENTITY_PATTERN = /&#([xX][\dA-Fa-f]+|\d+);?/g;

/**
 * Defuses numeric character references that decode to XML-forbidden code
 * points by escaping their `&` (`&#xFFFE;` becomes `&amp;#xFFFE;`), so a
 * single-pass HTML parser yields inert literal text instead of the decoded
 * character. Single linear scan: escaping (unlike deleting) cannot join
 * neighbors into a fresh reference, so no rescan loop — and no quadratic
 * blowup on adversarial input — is needed. Valid references pass through
 * untouched.
 */
export function neutralizeForbiddenXml10Entities(value: string): string {
  return value.replace(
    FORBIDDEN_XML10_ENTITY_PATTERN,
    (match: string, digits: string) => {
      const codePoint =
        digits.startsWith('x') || digits.startsWith('X')
          ? Number.parseInt(digits.slice(1), 16)
          : Number.parseInt(digits, 10);
      return Number.isSafeInteger(codePoint) && isXml10CharCodePoint(codePoint)
        ? match
        : `&amp;${match.slice(1)}`;
    }
  );
}

/**
 * Removes raw code points that XML 1.0 cannot represent. Plain-text path
 * for titles, excerpts, authors, and categories: the feed serializer
 * escapes ampersands, so literal text like `&#x0;` stays valid output and
 * must be preserved — only actual forbidden characters are removed.
 * Nullish input yields an empty string so nullable DB columns degrade
 * gracefully instead of throwing inside feed builders.
 */
export function stripInvalidXml10Characters(
  value: string | null | undefined
): string {
  if (typeof value !== 'string') {
    return '';
  }
  let result = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isXml10CharCodePoint(codePoint)) {
      result += character;
    }
  }
  return result;
}

/**
 * Pre-HTML-parsing normalization: removes raw forbidden characters first
 * (so a control splitting a reference joins before the entity scan), then
 * defuses surviving references that decode to forbidden code points.
 * Needed only before sanitize-html, which decodes entities and would
 * otherwise let `java&#xFFFE;script:` slip past scheme validation and join
 * into `javascript:` under the outer strip. Never use on plain feed text.
 */
export function normalizeXml10ForHtmlParsing(
  value: string | null | undefined
): string {
  if (typeof value !== 'string') {
    return '';
  }
  return neutralizeForbiddenXml10Entities(stripInvalidXml10Characters(value));
}
