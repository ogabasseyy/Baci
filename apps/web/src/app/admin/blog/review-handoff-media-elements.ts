// Tokenize top-level elements first: a bare <img ...> pattern also
// matches media-like text quoted inside another element's attribute
// (e.g. a div title), which is text, not an element. Quoted sections
// are consumed whole so their contents never match standalone.
const HTML_ELEMENT_PATTERN =
  /<[a-zA-Z][a-zA-Z0-9]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const MEDIA_ELEMENT_NAME_PATTERN = /^<(img|source)\b/i;

/**
 * Match actual img/source elements, skipping media-like text quoted
 * inside other elements' attributes. Callers must strip HTML comments
 * first: the tokenizer does not recognize comment openers.
 */
export function matchMediaElements(html: string): RegExpMatchArray[] {
  const elements: RegExpMatchArray[] = [];
  for (const match of html.matchAll(HTML_ELEMENT_PATTERN)) {
    if (MEDIA_ELEMENT_NAME_PATTERN.test(match[0])) {
      elements.push(match);
    }
  }
  return elements;
}
