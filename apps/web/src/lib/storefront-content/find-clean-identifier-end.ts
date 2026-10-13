function isInlineVariantMetadataToken(tokens: string[], index: number) {
  const token = tokens[index] ?? '';
  const nextToken = tokens[index + 1] ?? '';
  const previousToken = tokens[index - 1] ?? '';
  return (
    /^\d+(?:gb|tb|mb|w|v|hz|mah|mm|inch|in)$/u.test(token) ||
    (/^\d+$/u.test(token) &&
      /^(?:gb|tb|mb|w|v|hz|mah|mm|inch|in)$/u.test(nextToken)) ||
    (/^(?:gb|tb|mb|w|v|hz|mah|mm|inch|in)$/u.test(token) &&
      /^\d+$/u.test(previousToken))
  );
}

/** Finds an identifier end while allowing catalog variant metadata between model tokens. */
export function findCleanIdentifierEnd(
  tokens: string[],
  expectedTokens: string[],
  startIndex: number
) {
  let cursor = startIndex;
  for (const expectedToken of expectedTokens) {
    while (
      cursor < tokens.length &&
      tokens[cursor] !== expectedToken &&
      isInlineVariantMetadataToken(tokens, cursor)
    ) {
      cursor += 1;
    }
    if (tokens[cursor] !== expectedToken) {
      return null;
    }
    cursor += 1;
  }
  return cursor;
}
