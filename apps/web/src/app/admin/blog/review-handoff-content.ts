import { decodeHTMLAttribute } from 'entities';
import { marked } from 'marked';
import { isHttpsUrl } from '@/lib/is-https-url';
import { sanitizeHtml } from '@/lib/sanitize';
import { matchMediaElements } from './review-handoff-media-elements';
import { hasReadableContent } from './review-handoff-readability';
import { splitSrcsetCandidates } from './review-handoff-srcset';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';
import { stripLeadingNonRenderingText } from './strip-leading-non-rendering-text';

const INLINE_IMAGE_PLACEHOLDER_PATTERN = /\{\{\s*INLINE_IMAGE_\d+\s*\}\}/u;

// Lowercase only: like the sanitizer (and browsers), uppercase descriptors
// do not parse as width/density values. Density fractions accept a
// leading dot per the HTML floating-point grammar; a trailing dot stays
// invalid because the sanitizer strips it as an invalid descriptor.
const SRCSET_DESCRIPTOR_PATTERN =
  /^(\d+w|(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?x)$/;

function isValidSrcsetDescriptor(candidate: string): boolean {
  const parts = candidate.trim().split(/\s+/);
  // Descriptorless candidates default to 1x; more than one descriptor is
  // never valid, and a zero value selects no resource.
  if (parts.length <= 1) return true;
  if (parts.length > 2) return false;
  const descriptor = parts[1];
  // The HTML Standard excludes infinity from valid floating-point numbers,
  // so an overflowing density (parseFloat -> Infinity) is invalid even
  // though it matches the pattern and compares greater than zero.
  const density = Number.parseFloat(descriptor);
  return (
    SRCSET_DESCRIPTOR_PATTERN.test(descriptor) &&
    Number.isFinite(density) &&
    density > 0
  );
}

type MediaCandidate = { url: string; valid: boolean };

function mediaTagCandidates(tag: string): MediaCandidate[] {
  const candidates: MediaCandidate[] = [];
  for (const { name, value } of tagAttributes(tag)) {
    // The HTML tokenizer resolves character references before URL
    // parsing, so decode first: an encoded `https&#58;//...` is a valid
    // absolute URL to the browser.
    if (name === 'src') {
      if (value)
        candidates.push({ url: decodeHTMLAttribute(value), valid: true });
    } else if (name === 'srcset') {
      for (const candidate of splitSrcsetCandidates(
        decodeHTMLAttribute(value)
      )) {
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
  // Strip invisible formatting (zero-width, bidi, BOM) as well as
  // whitespace so a pasted \u200B prefix cannot smuggle JSON into the
  // structured-content path.
  const trimmed = stripLeadingNonRenderingText(value);
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

type MediaGroup = {
  candidates: MediaCandidate[];
  hasMedia: boolean;
  imgSeen: boolean;
};

// Image MIME types browsers universally render. Anything else is
// skipped when selecting a picture resource, so it contributes no
// candidate here either.
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
]);

function isAlwaysFalseMediaQuery(value: string): boolean {
  // `not all` never matches any device, so the source can never be
  // selected. Every other query needs a viewport or device the
  // validator has not — including `not <type>` negations, which
  // match other devices — so only this exact shape is provably
  // inapplicable.
  return value.trim().toLowerCase().replace(/\s+/g, ' ') === 'not all';
}

function isApplicableSource(tag: string): boolean {
  // Browsers skip sources with unsupported types. In picture context
  // only supported image MIME types are meaningful; anything else
  // (or an empty type) contributes no candidate. A provably
  // non-matching media query skips the same way; any other media
  // value is assumed applicable, since matching it requires a
  // viewport the validator has not.
  let applicable = true;
  for (const { name, value } of tagAttributes(tag)) {
    if (name === 'type') {
      const essence = value.split(';')[0].trim().toLowerCase();
      if (!SUPPORTED_IMAGE_MIME_TYPES.has(essence)) applicable = false;
    } else if (name === 'media') {
      if (isAlwaysFalseMediaQuery(value)) applicable = false;
    }
  }
  return applicable;
}

function hasBrokenMediaTag(html: string): boolean {
  // Markdown rendering preserves editorial comments while the sanitizer
  // discards them, so strip first: a commented-out draft URL is not a
  // rendered image and must not reject the handoff. Elements (not
  // substrings) are matched so media-like text quoted inside another
  // element's attribute is not mistaken for a real image. Candidates
  // are evaluated per picture: a src-less img is supplied by its
  // picture sources, so judging it alone would reject valid responsive
  // markup. Standalone images form singleton groups under the same
  // rule; pictures without media elements are inert, not broken.
  const withoutComments = stripHtmlComments(html);
  const groups: MediaGroup[] = [];
  const pictureStack: MediaGroup[] = [];
  for (const [tag] of matchMediaElements(withoutComments)) {
    if (/^<picture\b/i.test(tag)) {
      const group: MediaGroup = {
        candidates: [],
        hasMedia: false,
        imgSeen: false,
      };
      groups.push(group);
      pictureStack.push(group);
      continue;
    }
    if (/^<\/picture\s*>/i.test(tag)) {
      pictureStack.pop();
      continue;
    }
    let group: MediaGroup;
    if (pictureStack.length > 0) {
      group = pictureStack[pictureStack.length - 1];
    } else {
      group = { candidates: [], hasMedia: true, imgSeen: false };
      groups.push(group);
    }
    // Only preceding applicable source siblings participate in
    // selecting the resource for the img: sources after the group's
    // img, and sources with inapplicable types, are ignored entirely.
    if (/^<img\b/i.test(tag)) {
      group.hasMedia = true;
      group.candidates.push(...mediaTagCandidates(tag));
      group.imgSeen = true;
    } else if (!group.imgSeen && isApplicableSource(tag)) {
      group.hasMedia = true;
      group.candidates.push(...mediaTagCandidates(tag));
    }
  }
  return groups.some(
    ({ candidates, hasMedia }) =>
      hasMedia &&
      (candidates.length === 0 ||
        candidates.some(
          ({ url, valid }) => !valid || !isImportableMediaUrl(url)
        ))
  );
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
