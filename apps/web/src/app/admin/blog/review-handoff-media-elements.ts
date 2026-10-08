// Tokenize top-level elements first: a bare <img ...> pattern also
// matches media-like text quoted inside another element's attribute
// (e.g. a div title), which is text, not an element. Quoted sections
// are consumed whole so their contents never match standalone.
const HTML_ELEMENT_PATTERN =
  /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const MEDIA_ELEMENT_NAME_PATTERN = /^<(img|source|picture)\b/i;
// HTML void elements cannot have children, so they never join the
// ancestry stack. This mirrors the same spec-fixed list used for
// readability ancestry.
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

type MediaElementMatch = RegExpMatchArray & {
  // Whether this match is an img whose parent element is a picture.
  // Only direct picture children associate with picture sources; a
  // nested img still renders, but as a standalone image.
  directPictureChild: boolean;
};

function flagMatch(
  match: RegExpMatchArray,
  directPictureChild: boolean
): MediaElementMatch {
  return Object.assign(match, { directPictureChild });
}

/**
 * Match img elements, picture-bound source elements, and picture
 * open/close tags in document order. A source contributes candidates
 * only as a direct picture child, so orphan, nested, and video/audio
 * sources never match; every img matches, flagged by whether its
 * parent is a picture. Callers must strip HTML comments first: the
 * tokenizer does not recognize comment openers.
 */
export function matchMediaElements(html: string): MediaElementMatch[] {
  const elements: MediaElementMatch[] = [];
  const ancestors: string[] = [];
  for (const match of html.matchAll(HTML_ELEMENT_PATTERN)) {
    const tagName = match[2].toLowerCase();
    if (match[1] === '/') {
      // Stray void-element closers are ignored like browsers ignore
      // them; anything else pops one open ancestor.
      if (tagName === 'picture') {
        elements.push(flagMatch(match, false));
        ancestors.pop();
      } else if (!VOID_ELEMENTS.has(tagName)) {
        ancestors.pop();
      }
      continue;
    }
    if (tagName === 'picture') {
      elements.push(flagMatch(match, false));
      ancestors.push(tagName);
      continue;
    }
    if (!MEDIA_ELEMENT_NAME_PATTERN.test(match[0])) {
      if (!VOID_ELEMENTS.has(tagName)) ancestors.push(tagName);
      continue;
    }
    if (tagName === 'source' && ancestors[ancestors.length - 1] !== 'picture') {
      continue;
    }
    elements.push(
      flagMatch(
        match,
        tagName === 'img' && ancestors[ancestors.length - 1] === 'picture'
      )
    );
  }
  return elements;
}
