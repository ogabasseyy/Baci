const JSON_STRING_ESCAPE_PATTERN = /\\(?:\/|u00([0-9A-Fa-f]{2}))/g;

/**
 * Unescape JSON string escapes in stored text before URL matching.
 * Structured editor content serializes image sources with escaped
 * slashes (`https:\/\/...`, `\u002f`) and escaped URL characters
 * (`\u0074oken`), which the storefront's `JSON.parse` resolves to
 * the live URL: without unescaping, reference scans never match the
 * literal candidate path and the sweep deletes a live image. One
 * left-to-right pass decodes exactly what `JSON.parse` would for
 * this subset, so decoded output is never rescanned (`\u005c` yields
 * one literal backslash, not a new escape). Only ASCII escapes
 * decode — higher planes stay literal since managed URLs cannot
 * contain them unencoded — and `\u0000` stays literal because NUL
 * cannot live in stored text comparisons.
 */
export function unescapeJsonStringEscapes(text: string): string {
  return text.replace(JSON_STRING_ESCAPE_PATTERN, (match, hex) => {
    if (hex === undefined) return '/';
    if ((hex as string).toLowerCase() === '00') return match;
    return String.fromCharCode(Number.parseInt(hex as string, 16));
  });
}
