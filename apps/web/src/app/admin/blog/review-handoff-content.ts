import { marked } from 'marked';
import { isHttpsUrl } from '@/lib/is-https-url';
import { sanitizeHtml } from '@/lib/sanitize';
import { stripNonRenderingText } from './strip-non-rendering-text';

const INLINE_IMAGE_PLACEHOLDER_PATTERN = /\{\{\s*INLINE_IMAGE_\d+\s*\}\}/u;
const MEDIA_TAG_PATTERN = /<(img|source)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
const IMG_TAG_PATTERN = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
const MEDIA_ATTRIBUTE_PATTERN = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

// Lowercase only: like the sanitizer (and browsers), uppercase descriptors
// do not parse as width/density values.
const SRCSET_DESCRIPTOR_PATTERN = /^(\d+w|\d+(\.\d+)?([eE][+-]?\d+)?x)$/;

function isValidSrcsetDescriptor(candidate: string): boolean {
  const parts = candidate.trim().split(/\s+/);
  // Descriptorless candidates default to 1x; more than one descriptor is
  // never valid, and a zero value selects no resource.
  if (parts.length <= 1) return true;
  if (parts.length > 2) return false;
  const descriptor = parts[1];
  return (
    SRCSET_DESCRIPTOR_PATTERN.test(descriptor) &&
    Number.parseFloat(descriptor) > 0
  );
}

type MediaCandidate = { url: string; valid: boolean };

function mediaTagCandidates(tag: string): MediaCandidate[] {
  const candidates: MediaCandidate[] = [];
  for (const match of tag.matchAll(MEDIA_ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    const value = unquoteAttributeValue(match[2]);
    if (name === 'src') {
      if (value) candidates.push({ url: value, valid: true });
    } else if (name === 'srcset') {
      for (const candidate of splitSrcsetCandidates(value)) {
        const candidateUrl = candidate.trim().split(/\s+/, 1)[0];
        if (candidateUrl) {
          candidates.push({
            url: candidateUrl,
            valid: isValidSrcsetDescriptor(candidate),
          });
        }
      }
    }
  }
  return candidates;
}

function isImportableMediaUrl(url: string): boolean {
  // Embedded data: URLs are rejected outright: no MIME check or payload
  // sniffing can prove the bytes decode to a renderable image without a
  // real decoder, so handoff imports require hosted HTTPS media. The
  // reviewer hosts the image (or uses the upload API) instead.
  return isHttpsUrl(url);
}

function stripMarkupText(value: string): string {
  return value.replace(/<[^>]*>/gu, '').trim();
}

// A brace followed by a quote opens a JSON object (allowing whitespace), as
// opposed to `{`-led prose such as `{Note}: ...`.
const LEADING_JSON_OBJECT_PATTERN = /^\{\s*"/u;

function isJsonShapedText(value: string): boolean {
  const trimmed = value.trimStart();
  // Both consumers (BlogEditor, BlogContentRenderer) attempt JSON.parse and
  // fall back to ordinary content on failure, so full-parseable content is
  // barred while `{`-led prose ({Note}: ...) and `[`-led markdown (links,
  // markers) pass through. A `{"`-led prefix is still rejected even with
  // trailing garbage: it smells like a mangled JSON document, so fail fast
  // instead of importing it as body text.
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  if (LEADING_JSON_OBJECT_PATTERN.test(trimmed)) return true;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function normalizeContent(
  rawContent: string,
  sanitizedRaw: string
): { content: string; rendered: string } {
  try {
    const rendered = marked.parse(rawContent, { async: false }) as string;
    // Store what the editor displays: BlogEditor renders non-JSON content
    // through marked, so persisting raw markdown would publish literal syntax
    // the reviewer never saw. HTML and plain text render to identical text
    // and sanitize as before. Rendering first also preserves markdown code
    // examples: sanitizing the raw source would delete disallowed HTML inside
    // fenced blocks before marked can escape it as code.
    // Indented code blocks render to text-identical HTML (<pre> adds no text),
    // so text comparison alone would store raw markdown that the renderer
    // displays as plain text instead of the code block the editor shows.
    // GFM bare-URL autolinks are the same trap: rendering adds an <a> the
    // text comparison cannot see, so the stored copy must be the rendered
    // output or the published page loses a link the reviewer saw.
    const renderedIntroducesLink =
      /<a[\s>]/i.test(rendered) && !/<a[\s>]/i.test(rawContent);
    if (
      !/<pre[\s>]/i.test(rendered) &&
      !renderedIntroducesLink &&
      stripMarkupText(rendered) === stripMarkupText(rawContent)
    ) {
      return { content: sanitizedRaw, rendered };
    }
    return { content: sanitizeHtml(rendered), rendered };
  } catch {
    return { content: sanitizedRaw, rendered: sanitizedRaw };
  }
}

function hasBrokenMediaTag(html: string): boolean {
  return (html.match(MEDIA_TAG_PATTERN) ?? []).some((tag) => {
    const candidates = mediaTagCandidates(tag);
    return (
      candidates.length === 0 ||
      candidates.some(({ url, valid }) => !valid || !isImportableMediaUrl(url))
    );
  });
}

const NEW_CANDIDATE_URL_PATTERN = /^(data:|[a-z][a-z\d+.-]*:\/\/)/i;
const DATA_URL_PREFIX_PATTERN = /^\s*data:/i;

function isCandidateBoundary(current: string, piece: string): boolean {
  const accumulated = current.trim();
  // A URL followed by a descriptor is a complete candidate.
  if (/\s/.test(accumulated)) {
    return true;
  }
  const next = piece.trim();
  // Inside a data: URL commas are payload (base64 padding, SVG markup),
  // never separators: gluing keeps the data: URL whole so it is rejected
  // as one non-HTTPS candidate. The one exception is an unambiguous new
  // candidate: a scheme-absolute URL carrying a descriptor cannot be
  // data: payload, which holds no raw whitespace before its own descriptor.
  if (DATA_URL_PREFIX_PATTERN.test(accumulated)) {
    return NEW_CANDIDATE_URL_PATTERN.test(next) && /\s/.test(next);
  }
  // An absolute URL or embedded image always starts a new candidate.
  if (NEW_CANDIDATE_URL_PATTERN.test(next)) {
    return true;
  }
  // Inside a query string commas separate values, never candidates (RFC
  // 3986 sub-delims): a comma here glues no matter what the value looks
  // like, so the next piece is never classified.
  if (/\?[^#]*$/.test(accumulated)) {
    return false;
  }
  // A comma continues the current candidate only inside a CDN transform
  // parameter list: the accumulated text ends mid-assignment (key=partial
  // value) and the next piece continues assignments — another key=value
  // segment (see buildOgabasseyAvifSrcSet) or a bare numeric value.
  // Either side alone proves nothing: relative path segments may
  // themselves contain `=`.
  const endsMidAssignment = /=[^/?#\s]*$/.test(accumulated);
  const firstToken = next.split(/\s+/, 1)[0];
  const segment = firstToken.split(/[/?#]/, 1)[0];
  const continuesAssignments =
    segment.includes('=') || /^\d+(\.\d+)?$/.test(firstToken);
  return !(endsMidAssignment && continuesAssignments);
}

function splitSrcsetCandidates(srcset: string): string[] {
  const candidates: string[] = [];
  // A comma ends a candidate at a candidate boundary (see above). Gluing
  // is only safe for CDN transform parameters and data: payloads: any
  // other glued piece hides its URL from validation behind the first
  // token while the browser still selects it. Splitting is the fail-closed
  // direction: every emitted candidate is URL-validated.
  let current = '';
  for (const piece of srcset.split(',')) {
    if (piece.trim() === '') continue;
    if (current !== '' && isCandidateBoundary(current, piece)) {
      candidates.push(current);
      current = piece;
    } else if (current === '') {
      current = piece;
    } else {
      current += `,${piece}`;
    }
  }
  if (current !== '') candidates.push(current);
  return candidates;
}

function unquoteAttributeValue(raw: string): string {
  return raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
}

function isZeroSizedImage(tag: string): boolean {
  // A zero width or height renders no pixels. Only bare zeros count: the
  // width/height attributes take plain pixel counts, so `0px` is invalid
  // and ignored by browsers (natural size, still visible).
  for (const match of tag.matchAll(MEDIA_ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (name !== 'width' && name !== 'height') continue;
    if (/^0+$/.test(unquoteAttributeValue(match[2]).trim())) return true;
  }
  return false;
}

function hasVisibilityHidingClass(tag: string): boolean {
  // The sanitizer preserves class but strips style, so display:none and
  // visibility:hidden arrive only as Tailwind tokens. Match exact tokens:
  // `hidden` must not match `unhidden`.
  for (const match of tag.matchAll(MEDIA_ATTRIBUTE_PATTERN)) {
    if (match[1].toLowerCase() !== 'class') continue;
    const tokens = unquoteAttributeValue(match[2]).split(/\s+/);
    if (tokens.some((token) => token === 'hidden' || token === 'invisible')) {
      return true;
    }
  }
  return false;
}

function hasReadableContent(content: string): boolean {
  // A bare <source> renders nothing without an accompanying <img>, and a
  // zero-sized or CSS-hidden <img> renders no pixels either.
  for (const match of content.matchAll(IMG_TAG_PATTERN)) {
    const tag = match[0];
    if (!isZeroSizedImage(tag) && !hasVisibilityHidingClass(tag)) return true;
  }
  const text = stripNonRenderingText(
    content.replace(/<[^>]*>/gu, '').replace(/&nbsp;/gi, ' ')
  ).trim();
  return text.length > 0;
}

/**
 * Validate handoff article content and return the HTML to store.
 * Normalizes markdown to rendered HTML, rejects JSON-shaped text,
 * unresolved placeholders, unreadable bodies, and unrenderable media.
 */
export function validateImportedContent(rawContent: string): string {
  if (INLINE_IMAGE_PLACEHOLDER_PATTERN.test(rawContent)) {
    throw new Error('The article has unresolved inline image placeholders');
  }
  const sanitizedRaw = sanitizeHtml(rawContent);
  // The JSON-shape guard runs pre-conversion: markdown rendering wraps text
  // in <p> tags (and escapes quotes), which would otherwise smuggle JSON past
  // the structured-content check.
  if (isJsonShapedText(rawContent) || isJsonShapedText(sanitizedRaw)) {
    throw new Error(
      'Article content must be HTML, not JSON-shaped text. Wrap literal JSON examples in HTML.'
    );
  }
  const { content, rendered } = normalizeContent(rawContent, sanitizedRaw);
  if (!content.trim()) {
    throw new Error('Article content is empty after sanitization');
  }
  // Sanitization decodes HTML entities, which can reveal placeholders hidden
  // from the raw-text check above (e.g. &#123;&#123;INLINE_IMAGE_1&#125;&#125;).
  if (INLINE_IMAGE_PLACEHOLDER_PATTERN.test(content)) {
    throw new Error('The article has unresolved inline image placeholders');
  }
  if (!hasReadableContent(content)) {
    throw new Error('Article content has no readable text or images');
  }
  // Validate the rendered markup as well as the stored markup: the
  // sanitizer strips invalid descriptors and data: candidates, which would
  // otherwise hide broken media from a stored-only check. Either layer
  // rejects loudly instead of silently persisting a crippled image.
  if (hasBrokenMediaTag(rendered) || hasBrokenMediaTag(content)) {
    throw new Error('Imported inline images must use HTTPS URLs');
  }
  return content;
}
