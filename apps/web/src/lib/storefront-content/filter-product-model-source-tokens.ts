/** Retains source tokens required to identify models after category filtering. */
export function filterProductModelSourceTokens(
  tokens: string[],
  excludedTokens: ReadonlySet<string>
) {
  return tokens.filter(
    (token, index) =>
      !excludedTokens.has(token) ||
      (token === 'in' &&
        tokens[index - 1] === 'all' &&
        tokens[index + 1] === 'one') ||
      (token === 'printer' &&
        tokens[index - 1] === 'one' &&
        tokens[index - 2] === 'in' &&
        tokens[index - 3] === 'all')
  );
}
