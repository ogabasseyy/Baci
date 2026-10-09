const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
};

const ENTITY_PATTERN =
  /&(?:#(\d+);?|#[xX]([0-9A-Fa-f]+);?|([A-Za-z][A-Za-z0-9]+);)/g;

function codePointToChar(point: number, match: string): string {
  // NUL, surrogates, and out-of-range values stay literal: NUL
  // cannot live in text comparisons and the rest never appear in
  // managed URLs, mirroring the SQL decoder exactly.
  if (point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
    return match;
  }
  return String.fromCodePoint(point);
}

/**
 * Decode HTML character references in stored text before URL
 * matching. Persisted content spells URLs with entities (`tok&#
 * x65;n.webp`), which HTML parsing resolves to the live URL: without
 * decoding, reference scans miss the candidate path and the sweep
 * deletes rendered media. Numeric references decode with or without
 * the semicolon (the parser flags the missing terminator but still
 * resolves the longest digit run); named references keep requiring
 * it. Codepoints cover the full scalar range while unknown names
 * stay literal. Runs before JSON and percent decoding — entities
 * can reveal both (`&#x25;32`, `&#x5c;u002f`) — in this layer and
 * the SQL mirror.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (match, dec, hex, name) => {
    if (dec !== undefined) return codePointToChar(Number(dec), match);
    if (hex !== undefined) {
      return codePointToChar(Number.parseInt(hex as string, 16), match);
    }
    return NAMED_ENTITIES[name as string] ?? match;
  });
}
