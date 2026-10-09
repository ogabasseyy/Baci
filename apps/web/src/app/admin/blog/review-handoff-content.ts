import { marked } from 'marked';
import { sanitizeHtml } from '@/lib/sanitize';
import { hasClosedDialog } from './review-handoff-dialog';
import { hasUnrepresentableHiddenWrapper } from './review-handoff-disallowed-wrapper';
import { hasClosedDisclosure } from './review-handoff-disclosure';
import { parseHandoffDom } from './review-handoff-dom';
import { hasUnpreservableEmbed } from './review-handoff-embed';
import { hasUnpreservableFigure } from './review-handoff-figure';
import { convertHiddenAttributes } from './review-handoff-hidden-attributes';
import { convertHiddenInlineStyles } from './review-handoff-inline-styles';
import { groupMediaElements } from './review-handoff-media-groups';
import { hasBrokenMediaTag } from './review-handoff-media-validation';
import { stripNoscriptSubtrees } from './review-handoff-noscript-strip';
import { hasUnopenedPopover } from './review-handoff-popover';
import { hasReadableContent } from './review-handoff-readability';
import { stripHiddenContent } from './review-handoff-strip-hidden';
import { hasUnpreservableStylesheet } from './review-handoff-stylesheet';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripTemplateSubtrees } from './review-handoff-template-strip';
import { hasUnrepresentableVariance } from './review-handoff-variance';
import { stripLeadingNonRenderingText } from './strip-leading-non-rendering-text';

const INLINE_IMAGE_PLACEHOLDER_PATTERN = /\{\{\s*INLINE_IMAGE_\d+\s*\}\}/u;

function stripMarkupText(value: string): string {
  // Text comparison only: entity decoding applies to both sides, so
  // marked escaping `&` to `&amp;` no longer counts as a change.
  return (parseHandoffDom(value).body.textContent ?? '').trim();
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
    // Parse first, convert after: marked escapes fenced samples so
    // conversion cannot rewrite documented literal tags.
    const rendered = marked.parse(rawContent, { async: false }) as string;
    // Store what the editor displays: BlogEditor renders non-JSON content
    // through marked, so persisting raw markdown would publish literal syntax
    // the reviewer never saw. Rendering first also preserves markdown code
    // examples: sanitizing the raw source would delete disallowed HTML inside
    // fenced blocks before marked can escape it as code.
    // Indented code blocks and GFM bare-URL autolinks render to markup a
    // text comparison cannot see (<pre> adds no text; the <a> is new), so
    // the stored copy must be the rendered output when either appears.
    // Count, not presence: raw input may already hold an anchor while
    // rendering adds another for a bare URL on the same line.
    const countAnchors = (html: string) =>
      parseHandoffDom(html).querySelectorAll('a').length;
    const renderedIntroducesLink =
      countAnchors(rendered) > countAnchors(rawContent);
    if (
      parseHandoffDom(rendered).querySelector('pre') === null &&
      !renderedIntroducesLink &&
      stripMarkupText(rendered) === stripMarkupText(rawContent)
    ) {
      return { content: sanitizedRaw, rendered };
    }
    const converted = convertHiddenInlineStyles(
      convertHiddenAttributes(
        stripNoscriptSubtrees(stripTemplateSubtrees(rendered))
      )
    );
    return { content: sanitizeHtml(converted), rendered };
  } catch {
    return { content: sanitizedRaw, rendered: sanitizedRaw };
  }
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
  const doc = parseHandoffDom(html);
  const ids = new Set<string>();
  for (const element of doc.querySelectorAll('[id]')) {
    const id = element.getAttribute('id');
    if (id) ids.add(id);
  }
  for (const element of doc.querySelectorAll('[href]')) {
    const target = fragmentTarget(element.getAttribute('href') ?? '');
    if (target !== null && ids.has(target)) return true;
  }
  return false;
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

/**
 * Validate handoff article content and return the HTML to store.
 * Normalizes markdown to rendered HTML, rejects JSON-shaped text,
 * unresolved placeholders, unreadable bodies, editor-unrepresentable
 * responsive visibility, and unrenderable media.
 */
export function validateImportedContent(rawContent: string): string {
  // Convert hidden attributes and styles to hiding classes pre-sanitize.
  const unhidden = convertHiddenInlineStyles(
    convertHiddenAttributes(
      stripNoscriptSubtrees(stripTemplateSubtrees(rawContent))
    )
  );
  if (INLINE_IMAGE_PLACEHOLDER_PATTERN.test(unhidden)) {
    throw new Error('The article has unresolved inline image placeholders');
  }
  // Sanitization unwraps non-allowlisted tags and drops their classes
  // before the strip runs, so a hiding or showing marker on such a
  // tag reads differently on each side. Reject before that lossy step.
  if (hasUnrepresentableHiddenWrapper(unhidden)) {
    throw new Error(
      'Article content has hidden wrapper markup the editor cannot preserve'
    );
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
  const { content, rendered } = normalizeContent(rawContent, sanitizedRaw);
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
  // Figure structure cannot survive either: the editor defines image
  // and table nodes but no figure or figcaption node.
  if (hasUnpreservableFigure(visible)) {
    throw new Error(
      'Article content has figure markup the editor cannot preserve'
    );
  }
  // Closed disclosures cannot survive either: sanitization unwraps
  // the unrepresented control and exposes collapsed content. The
  // check runs pre-sanitize, since sanitization itself removes the
  // evidence.
  if (hasClosedDisclosure(rendered)) {
    throw new Error(
      'Article content has closed disclosure markup the editor cannot preserve'
    );
  }
  // Closed dialogs drift identically: sanitization unwraps the
  // unrepresented control and exposes hidden content.
  if (hasClosedDialog(rendered)) {
    throw new Error(
      'Article content has closed dialog markup the editor cannot preserve'
    );
  }
  // Replaced-media embeds cannot survive either: sanitization drops
  // the element while the surrounding body text lets the import
  // succeed, silently discarding the video.
  if (hasUnpreservableEmbed(rendered)) {
    throw new Error(
      'Article content has embed markup the editor cannot preserve'
    );
  }
  // Stylesheets cannot survive either: sanitization strips the block
  // while keeping the paragraphs it hides, silently exposing them.
  if (hasUnpreservableStylesheet(rendered)) {
    throw new Error(
      'Article content has stylesheet markup the editor cannot preserve'
    );
  }
  // Popovers cannot survive either: static markup cannot express the
  // shown state, and sanitization drops the attribute while keeping
  // the hidden note as visible text.
  if (hasUnopenedPopover(rendered)) {
    throw new Error(
      'Article content has popover markup the editor cannot preserve'
    );
  }
  return visible;
}
