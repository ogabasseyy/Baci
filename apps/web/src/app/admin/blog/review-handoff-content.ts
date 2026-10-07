import { marked } from 'marked';
import { isHttpsUrl } from '@/lib/is-https-url';
import { sanitizeHtml } from '@/lib/sanitize';

const INLINE_IMAGE_PLACEHOLDER_PATTERN = /\{\{\s*INLINE_IMAGE_\d+\s*\}\}/u;
const MEDIA_TAG_PATTERN = /<(img|source)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
const IMG_TAG_PATTERN = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
const MEDIA_ATTRIBUTE_PATTERN = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

function mediaTagUrls(tag: string): string[] {
  const urls: string[] = [];
  for (const match of tag.matchAll(MEDIA_ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    const raw = match[2];
    const value =
      raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
    if (name === 'src') {
      if (value) urls.push(value);
    } else if (name === 'srcset') {
      for (const candidate of splitSrcsetCandidates(value)) {
        const candidateUrl = candidate.trim().split(/\s+/, 1)[0];
        if (candidateUrl) urls.push(candidateUrl);
      }
    }
  }
  return urls;
}

// Subtypes mirror the admin upload INLINE_ALLOWED_TYPES: only formats the
// application renders are importable as embedded images.
const EMBEDDED_IMAGE_DATA_URL_PATTERN =
  /^data:image\/(jpeg|png|gif|webp|avif)((?:;[^;,]+)*);base64,/i;
const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeEmbeddedImageBytes(payload: string): readonly number[] | null {
  // Forgiving whitespace like browsers, then strict alphabet: anything
  // outside base64 is not decodable image bytes.
  const compact = payload.replace(/\s+/g, '');
  if (compact.length === 0) return null;
  const padded = compact + '='.repeat((4 - (compact.length % 4)) % 4);
  if (!BASE64_PAYLOAD_PATTERN.test(padded)) return null;
  try {
    const binary = atob(padded);
    return Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hasExpectedImageSignature(
  subtype: string,
  bytes: readonly number[]
): boolean {
  const ascii = (start: number, text: string) =>
    text
      .split('')
      .every((char, index) => bytes[start + index] === char.charCodeAt(0));
  switch (subtype) {
    case 'png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        ascii(1, 'PNG') &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case 'jpeg':
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case 'gif':
      return bytes.length >= 6 && ascii(0, 'GIF8');
    case 'webp':
      return bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'avif':
      return (
        bytes.length >= 12 &&
        ascii(4, 'ftyp') &&
        (ascii(8, 'avif') || ascii(8, 'avis'))
      );
    default:
      return false;
  }
}

function isEmbeddedImageUrl(url: string): boolean {
  // A supported subtype plus an opaque payload is not proof the browser
  // can decode the image, so decode the base64 payload and check the
  // format signature. Non-base64 payloads cannot be decoded reliably and
  // are rejected.
  const header = EMBEDDED_IMAGE_DATA_URL_PATTERN.exec(url);
  const subtype = header?.[1]?.toLowerCase();
  if (!header || !subtype) return false;
  const bytes = decodeEmbeddedImageBytes(url.slice(header[0].length));
  return bytes !== null && hasExpectedImageSignature(subtype, bytes);
}

function isImportableMediaUrl(url: string): boolean {
  if (url.toLowerCase().startsWith('data:')) return isEmbeddedImageUrl(url);
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

function normalizeContent(rawContent: string, sanitizedRaw: string): string {
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
      return sanitizedRaw;
    }
    return sanitizeHtml(rendered);
  } catch {
    return sanitizedRaw;
  }
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
  // never separators: splitting would shred embedded images the import
  // schema explicitly allows. The one exception is an unambiguous new
  // candidate: a scheme-absolute URL carrying a descriptor cannot be
  // data: payload, which holds no raw whitespace before its own descriptor.
  if (DATA_URL_PREFIX_PATTERN.test(accumulated)) {
    return NEW_CANDIDATE_URL_PATTERN.test(next) && /\s/.test(next);
  }
  // An absolute URL or embedded image always starts a new candidate.
  if (NEW_CANDIDATE_URL_PATTERN.test(next)) {
    return true;
  }
  // A comma continues the current candidate only inside a CDN transform
  // parameter list: the accumulated text ends mid-assignment (key=partial
  // value) and the next piece continues assignments — another key=value
  // segment (see buildOgabasseyAvifSrcSet) or a bare numeric value such as
  // the `2` in `?crop=1,2`. Either side alone proves nothing: relative
  // path segments may themselves contain `=`.
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

// Default-ignorable marks (U+034F, variation selectors, ...) render nothing
// but are category Mn rather than Cf/Cc, so the general Unicode property
// carries them while Cc stays explicit.
const NON_RENDERING_TEXT_PATTERN = /[\p{Cc}\p{Default_Ignorable_Code_Point}]/gu;

function hasReadableContent(content: string): boolean {
  // A bare <source> renders nothing without an accompanying <img>.
  if (content.match(IMG_TAG_PATTERN)) return true;
  const text = content
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(NON_RENDERING_TEXT_PATTERN, '')
    .trim();
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
  const content = normalizeContent(rawContent, sanitizedRaw);
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
  const hasBrokenMedia = (content.match(MEDIA_TAG_PATTERN) ?? []).some(
    (tag) => {
      const urls = mediaTagUrls(tag);
      return (
        urls.length === 0 || urls.some((url) => !isImportableMediaUrl(url))
      );
    }
  );
  if (hasBrokenMedia) {
    throw new Error('Imported inline images must use HTTPS URLs');
  }
  return content;
}
