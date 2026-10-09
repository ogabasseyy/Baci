import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { stripHtmlComments } from './strip-html-comments';

// Script, style, textarea, and title contents are tag-opaque: a
// noscript opener inside them is text, not markup. The scan ends at
// the first matching close exactly like the parser (even inside a
// quoted string), or runs to end of input when unclosed — also like
// the parser. An early opener end at a `>` inside an attribute value
// still re-syncs at the real close, so visible content after the
// block always survives.
const RAW_TEXT_BLOCK_PATTERN =
  /<(script|style|textarea|title)\b[^>]*>(?:[\s\S]*?<\/\1\s*>|$)/gi;

function stripRawTextBlocks(html: string): string {
  return html.replace(RAW_TEXT_BLOCK_PATTERN, '');
}

/**
 * Remove noscript subtrees before sanitization. Noscript contents
 * never render in the scripting-enabled source document, but the
 * sanitizer discards only the disallowed wrapper and keeps its
 * allowed descendants — surfacing notes the author never displayed.
 * Nesting tracks depth (a self-closing slash opens like browsers
 * do), an unclosed noscript drops to end of input, and stray closes
 * pass through for the sanitizer to discard. Comments strip first: a
 * noscript opener inside comment text is not markup, and the
 * sanitizer drops comments anyway. Raw-text blocks strip next: a
 * noscript opener inside script text is not markup either, and the
 * sanitizer drops those blocks anyway. This scan stays lexical
 * because parsing promotes noscript children to markup, hiding the
 * wrapper it must see.
 */
export function stripNoscriptSubtrees(html: string): string {
  const source = stripRawTextBlocks(stripHtmlComments(html));
  const segments: string[] = [];
  let depth = 0;
  let position = 0;
  for (const match of source.matchAll(HTML_TAG_PATTERN)) {
    const index = match.index ?? source.length;
    if (depth === 0) segments.push(source.slice(position, index));
    position = index + match[0].length;
    if (match[2].toLowerCase() !== 'noscript') {
      if (depth === 0) segments.push(match[0]);
      continue;
    }
    if (match[1] === '/') {
      if (depth > 0) depth -= 1;
      else segments.push(match[0]);
    } else {
      depth += 1;
    }
  }
  if (depth === 0) segments.push(source.slice(position));
  return segments.join('');
}
