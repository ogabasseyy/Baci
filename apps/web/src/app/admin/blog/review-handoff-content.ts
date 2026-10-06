import { marked } from 'marked';
import { isHttpsUrl } from '@/lib/blog-utils';
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

const DATA_IMAGE_URL_PATTERN = /^data:image\/[^,]+,/u;

function isEmbeddedImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const match = DATA_IMAGE_URL_PATTERN.exec(lower);
  // Image MIME type plus a non-empty payload; bare `data:` or non-image
  // payloads (data:text/html, ...) cannot render in an <img>.
  return match !== null && match[0].length < lower.length;
}

function isImportableMediaUrl(url: string): boolean {
  if (url.toLowerCase().startsWith('data:')) return isEmbeddedImageUrl(url);
  return isHttpsUrl(url);
}

function stripMarkupText(value: string): string {
  return value.replace(/<[^>]*>/gu, '').trim();
}

function isJsonShapedText(value: string): boolean {
  const trimmed = value.trimStart();
  // The editor parses `{`-led content as structured data, so any object
  // shape is rejected. `[` alone is ordinary prose or markdown (links,
  // markers); only content that actually parses as a JSON array is barred.
  if (trimmed.startsWith('{')) return true;
  if (!trimmed.startsWith('[')) return false;
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
    if (stripMarkupText(rendered) === stripMarkupText(rawContent)) {
      return sanitizedRaw;
    }
    return sanitizeHtml(rendered);
  } catch {
    return sanitizedRaw;
  }
}

const SRCSET_CANDIDATE_SEPARATOR = /,\s+/;

function splitSrcsetCandidates(srcset: string): string[] {
  const candidates: string[] = [];
  // Repo convention (see buildOgabasseyAvifSrcSet): CDN transform commas are
  // never followed by whitespace, so candidates split on comma+whitespace.
  // A descriptor bearing a comma means bare-comma separation was used; re-split
  // strictly so a second URL cannot hide unvalidated behind the first.
  for (const candidate of srcset.split(SRCSET_CANDIDATE_SEPARATOR)) {
    const [, ...descriptors] = candidate.trim().split(/\s+/);
    if (descriptors.some((descriptor) => descriptor.includes(','))) {
      candidates.push(...candidate.split(','));
    } else {
      candidates.push(candidate);
    }
  }
  return candidates;
}

const INVISIBLE_TEXT_PATTERN = /[\u200B-\u200D\u00AD]/gu;

function hasReadableContent(content: string): boolean {
  // A bare <source> renders nothing without an accompanying <img>.
  if (content.match(IMG_TAG_PATTERN)) return true;
  const text = content
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(INVISIBLE_TEXT_PATTERN, '')
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
