/**
 * Unescape JSON slash spellings in stored text before URL matching.
 * Structured editor content serializes image sources with escaped
 * slashes (`https:\/\/...` or `\u002f`), which the storefront parses
 * and renders: without unescaping, reference scans never match the
 * literal candidate path and the sweep deletes a live image. Only
 * slash spellings unescape — general unicode escapes stay literal,
 * since blindly decoding `\uXXXX` would rewrite unrelated text.
 */
export function unescapeJsonSlashes(text: string): string {
  return text.replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/');
}
