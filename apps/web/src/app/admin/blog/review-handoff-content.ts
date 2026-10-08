import { decodeHTMLAttribute } from 'entities';
import { marked } from 'marked';
import { isHttpsUrl } from '@/lib/is-https-url';
import { sanitizeHtml } from '@/lib/sanitize';
import { convertHiddenAttributes } from './review-handoff-hidden-attributes';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { groupMediaElements } from './review-handoff-media-groups';
import { hasReadableContent } from './review-handoff-readability';
import { splitSrcsetCandidates } from './review-handoff-srcset';
import { stripHiddenContent } from './review-handoff-strip-hidden';
import { tagAttributes } from './review-handoff-tag-attributes';
import { hasUnrepresentableVariance } from './review-handoff-variance';
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
    // Count, not presence: raw input may already hold an anchor while
    // rendering adds another for a bare URL on the same line.
    const countAnchors = (html: string) => html.match(/<a[\s>]/gi)?.length ?? 0;
    const renderedIntroducesLink =
      countAnchors(rendered) > countAnchors(rawContent);
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

function imgHasSrcValue(tag: string): boolean {
  // The editor parses `img[src]` and drops src-less images on mount.
  return tagAttributes(tag).some(
    ({ name, value }) => name === 'src' && value.trim() !== ''
  );
}

function fragmentTarget(href: string): string | null {
  if (!href.startsWith('#') || href.length < 2) return null;
  const raw = href.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function hasDroppedAnchorTarget(html: string): boolean {
  // StarterKit parses no id attribute, so the first editor update drops
  // every element id while the link mark keeps href="#...": an in-page
  // link whose target exists at import is broken at publish. Ids no
  // link targets are harmless; fragments with no matching id were
  // already broken before import and stay out of this check.
  const ids = new Set<string>();
  const fragments = new Set<string>();
  for (const match of html.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    for (const { name, value } of tagAttributes(match[0])) {
      if (name === 'id') {
        if (value) ids.add(value);
      } else if (name === 'href') {
        const target = fragmentTarget(value);
        if (target !== null) fragments.add(target);
      }
    }
  }
  return [...fragments].some((target) => ids.has(target));
}

function hasUnpreservableImgSrcset(html: string): boolean {
  // Tiptap image nodes keep src/alt/title/width/height only, so the
  // first body edit drops any srcset the browser would have selected
  // from. An empty srcset contributes nothing and stays accepted.
  for (const { tags } of groupMediaElements(html)) {
    for (const tag of tags) {
      if (!/^<img\b/i.test(tag)) continue;
      for (const { name, value } of tagAttributes(tag)) {
        if (name === 'srcset' && value.trim() !== '') return true;
      }
    }
  }
  return false;
}

function hasSelectablePictureSource(html: string): boolean {
  // Tiptap has no picture or source nodes, so the first body edit
  // serializes only the fallback img: an actively selected source is
  // silently lost. Inert sources (post-img, inapplicable) never
  // rendered anyway, so only selectable ones reject.
  return groupMediaElements(html).some(({ tags }) =>
    tags.some((tag) => /^<source\b/i.test(tag))
  );
}

function hasBrokenMediaTag(html: string): boolean {
  // Candidates are evaluated per picture while every img still needs
  // its own src: the editor drops src-less images on mount, so a
  // src-less img breaks the handoff on its own whatever the picture
  // sources supply. Pictures without media elements are inert, not broken.
  return groupMediaElements(html).some(({ tags, hasMedia }) => {
    if (!hasMedia) return false;
    if (tags.some((tag) => /^<img\b/i.test(tag) && !imgHasSrcValue(tag))) {
      return true;
    }
    const candidates = tags.flatMap(mediaTagCandidates);
    return (
      candidates.length === 0 ||
      candidates.some(({ url, valid }) => !valid || !isImportableMediaUrl(url))
    );
  });
}

/**
 * Validate handoff article content and return the HTML to store.
 * Normalizes markdown to rendered HTML, rejects JSON-shaped text,
 * unresolved placeholders, unreadable bodies, editor-unrepresentable
 * responsive visibility, and unrenderable media.
 */
export function validateImportedContent(rawContent: string): string {
  // The sanitizer drops the unsupported hidden attribute, so convert
  // HTML-hidden elements to hiding classes before anything else: the
  // uniform strip then removes them instead of surfacing them.
  const unhidden = convertHiddenAttributes(rawContent);
  if (INLINE_IMAGE_PLACEHOLDER_PATTERN.test(unhidden)) {
    throw new Error('The article has unresolved inline image placeholders');
  }
  const sanitizedRaw = sanitizeHtml(unhidden);
  // The JSON-shape guard runs pre-conversion: markdown rendering wraps text
  // in <p> tags (and escapes quotes), which would otherwise smuggle JSON past
  // the structured-content check.
  if (isJsonShapedText(unhidden) || isJsonShapedText(sanitizedRaw)) {
    throw new Error(
      'Article content must be HTML, not JSON-shaped text. Wrap literal JSON examples in HTML.'
    );
  }
  const { content, rendered } = normalizeContent(unhidden, sanitizedRaw);
  if (!content.trim()) {
    throw new Error('Article content is empty after sanitization');
  }
  // Sanitization decodes HTML entities, which can reveal placeholders hidden
  // from the raw-text check above (e.g. &#123;&#123;INLINE_IMAGE_1&#125;&#125;).
  if (INLINE_IMAGE_PLACEHOLDER_PATTERN.test(content)) {
    throw new Error('The article has unresolved inline image placeholders');
  }
  // The editor drops input classes: strip always-hidden content first.
  const visible = stripHiddenContent(content);
  if (!hasReadableContent(visible)) {
    throw new Error('Article content has no readable text or images');
  }
  // Viewport- or theme-dependent hiding cannot survive the editor
  // round-trip: kept content would surface where the source hides it.
  if (hasUnrepresentableVariance(visible)) {
    throw new Error(
      'Article content uses responsive visibility the editor cannot preserve'
    );
  }
  // Element ids cannot survive the editor round-trip either: the first
  // update drops them while keeping in-page links, breaking the targets.
  if (hasDroppedAnchorTarget(visible)) {
    throw new Error(
      'Article content has in-page links to ids the editor cannot preserve'
    );
  }
  // Validate the rendered markup as well as the stored markup: the
  // sanitizer strips invalid descriptors and data: candidates, which would
  // otherwise hide broken media from a stored-only check. Either layer
  // rejects loudly instead of silently persisting a crippled image.
  if (hasBrokenMediaTag(rendered) || hasBrokenMediaTag(visible)) {
    throw new Error('Imported inline images must use HTTPS URLs');
  }
  // Actively selected picture sources cannot survive the editor
  // round-trip: the first body edit keeps only the fallback img.
  if (hasSelectablePictureSource(visible)) {
    throw new Error(
      'Article content has responsive picture sources the editor cannot preserve'
    );
  }
  // Standalone img srcsets cannot survive either: image nodes keep
  // only src/alt/title/width/height.
  if (hasUnpreservableImgSrcset(visible)) {
    throw new Error(
      'Article content has responsive image srcsets the editor cannot preserve'
    );
  }
  return visible;
}
