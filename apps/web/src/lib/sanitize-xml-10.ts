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

function stripForbiddenXml10Entities(value: string): string {
  return value.replace(
    FORBIDDEN_XML10_ENTITY_PATTERN,
    (match: string, digits: string) => {
      const codePoint =
        digits.startsWith('x') || digits.startsWith('X')
          ? Number.parseInt(digits.slice(1), 16)
          : Number.parseInt(digits, 10);
      return Number.isSafeInteger(codePoint) && isXml10CharCodePoint(codePoint)
        ? match
        : '';
    }
  );
}

/**
 * Removes code points that XML 1.0 cannot represent, including numeric
 * character references that decode to them. The entity handling matters
 * before HTML parsing: sanitize-html decodes `&#xFFFE;` after a raw-only
 * strip, which can join split content (e.g. schemes) that its own checks
 * already approved. Nullish input yields an empty string so nullable DB
 * columns degrade gracefully instead of throwing inside feed builders.
 */
export function stripInvalidXml10Characters(
  value: string | null | undefined
): string {
  if (typeof value !== 'string') {
    return '';
  }
  let result = '';
  for (const character of stripForbiddenXml10Entities(value)) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isXml10CharCodePoint(codePoint)) {
      result += character;
    }
  }
  return result;
}
