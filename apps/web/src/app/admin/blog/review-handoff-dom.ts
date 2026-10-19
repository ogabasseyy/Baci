/**
 * Parse handoff markup with the platform HTML parser. Every handoff
 * check used to scan raw tags with regular expressions, so each
 * module re-decided nesting, comments, valueless attributes, case,
 * and unclosed tags — and each decision could disagree with the
 * browser. Parsing once with the spec parser makes those answers
 * exact and identical everywhere: callers query the DOM instead of
 * matching strings. Runs in the browser import handler and under
 * jsdom in tests; never at module scope, so server rendering stays
 * untouched.
 */
export function parseHandoffDom(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}
