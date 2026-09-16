const LISTICLE_COUNT_SEPARATORS = new Set([':', '—', '–', '-']);

function isListicleWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}

function isListicleDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

/**
 * Matches "<identifier tokens> <separator> <digits>" (e.g. "iPhone 15 — 7")
 * with plain string scanning so identifier tokens are matched literally and
 * no dynamic RegExp is ever constructed.
 */
export function hasListicleCountSuffix(
  title: string,
  identifierTokens: string[]
): boolean {
  if (identifierTokens.length === 0) {
    return false;
  }
  const haystack = title.toLowerCase();
  const firstToken = identifierTokens[0]?.toLowerCase() ?? '';
  if (firstToken.length === 0) {
    return false;
  }
  const restTokens = identifierTokens
    .slice(1)
    .map((token) => token.toLowerCase());
  let searchFrom = 0;
  for (;;) {
    const matchIndex = haystack.indexOf(firstToken, searchFrom);
    if (matchIndex === -1) {
      return false;
    }
    let tokenEnd = matchIndex + firstToken.length;
    let matched = true;
    for (const token of restTokens) {
      let tokenStart = tokenEnd;
      while (isListicleWhitespace(haystack[tokenStart])) {
        tokenStart += 1;
      }
      if (
        tokenStart === tokenEnd ||
        !haystack.startsWith(token, tokenStart)
      ) {
        matched = false;
        break;
      }
      tokenEnd = tokenStart + token.length;
    }
    if (matched) {
      let separatorIndex = tokenEnd;
      while (isListicleWhitespace(haystack[separatorIndex])) {
        separatorIndex += 1;
      }
      const separator = haystack[separatorIndex];
      if (separator !== undefined && LISTICLE_COUNT_SEPARATORS.has(separator)) {
        let digitIndex = separatorIndex + 1;
        while (isListicleWhitespace(haystack[digitIndex])) {
          digitIndex += 1;
        }
        if (isListicleDigit(haystack[digitIndex])) {
          return true;
        }
      }
    }
    searchFrom = matchIndex + 1;
  }
}
