// Raw-text and RCDATA elements (script, style, textarea, title, and
// their historical siblings) never parse their contents as markup,
// and the sanitizer strips the blocks from stored articles. Like the
// comment pattern, alternatives are ordered so a proper closer wins,
// while an opener without a closer runs through the end of input the
// way browsers swallow the rest of the document.
const RAW_TEXT_BLOCK_PATTERN =
  /<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;

/**
 * Remove raw-text element blocks: lexical tag checks must not see
 * tags (or text) hidden inside script, style, or similar contents.
 */
export function stripRawTextBlocks(value: string): string {
  return value.replace(RAW_TEXT_BLOCK_PATTERN, '');
}
