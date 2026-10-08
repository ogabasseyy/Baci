import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';

/**
 * Remove inert template subtrees before sanitization. Template
 * contents never render in the source document, but the sanitizer
 * discards only the disallowed wrapper and keeps its allowed
 * descendants — surfacing notes the author never displayed. Nesting
 * tracks depth (a self-closing slash opens like browsers do), an
 * unclosed template drops to end of input, and stray closes pass
 * through for the sanitizer to discard.
 */
export function stripTemplateSubtrees(html: string): string {
  const segments: string[] = [];
  let depth = 0;
  let position = 0;
  for (const match of html.matchAll(HTML_TAG_PATTERN)) {
    const index = match.index ?? html.length;
    if (depth === 0) segments.push(html.slice(position, index));
    position = index + match[0].length;
    if (match[2].toLowerCase() !== 'template') {
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
  if (depth === 0) segments.push(html.slice(position));
  return segments.join('');
}
