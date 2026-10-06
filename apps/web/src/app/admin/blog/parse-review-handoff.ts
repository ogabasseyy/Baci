import { marked } from 'marked';
import { BLOG_INTENTS, type BlogIntent } from '@/config/blog-intent';
import { MAX_REVIEW_HANDOFF_CONTENT_LENGTH } from '@/config/blog-review-handoff';
import { validateBlogImageVariantIntegrity } from '@/lib/blog-discover-readiness';
import { generateSlug } from '@/lib/blog-utils';
import { sanitizeHtml } from '@/lib/sanitize';
import { blogPostSchema } from '@/lib/validations/blog';
import type { PlatformAdminBlogFormState } from './blog-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const NULL_BYTE = String.fromCharCode(0);

function readText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // PostgreSQL text rejects null bytes, so fail fast instead of importing a
  // draft that can never save.
  if (value.includes(NULL_BYTE)) {
    throw new Error('Imported text must not contain null bytes');
  }
  return value.trim();
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

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

export function parseReviewHandoff(value: unknown): PlatformAdminBlogFormState {
  if (
    !isRecord(value) ||
    value.schema_version !== 'baci-blog-review-handoff/v1'
  ) {
    throw new Error('Unsupported review handoff format');
  }

  const title = readText(value.title);
  const rawContent = readText(value.content_html);
  if (!title || !rawContent) {
    throw new Error('A title and article content are required');
  }
  if (rawContent.length > MAX_REVIEW_HANDOFF_CONTENT_LENGTH) {
    throw new Error('Article content exceeds the import limit');
  }
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

  const featuredImage = isRecord(value.featured_image)
    ? value.featured_image
    : {};
  const featuredImageUrl = readText(featuredImage.url);
  if (!isHttpsUrl(featuredImageUrl)) {
    throw new Error('An HTTPS featured-image URL is required');
  }

  if (
    value.tags !== undefined &&
    value.tags !== null &&
    (!Array.isArray(value.tags) ||
      value.tags.some((tag) => typeof tag !== 'string'))
  ) {
    throw new Error('Imported tags must be an array of strings');
  }
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  if (tags.some((tag) => tag.includes(NULL_BYTE))) {
    throw new Error('Imported tags must not contain null bytes');
  }
  if (tags.some((tag) => tag.includes(','))) {
    throw new Error(
      'Imported tag names cannot contain commas. Use separate tags or rename the tag.'
    );
  }
  const imageVariants = isRecord(featuredImage.variants)
    ? Object.fromEntries(
        Object.entries(featuredImage.variants).filter(
          (entry): entry is [string, string] =>
            isHttpsUrl(entry[1]) &&
            validateBlogImageVariantIntegrity(
              { featured_image_variants: { [entry[0]]: entry[1] } },
              { kind: 'platform' }
            ).ready
        )
      )
    : {};
  for (const field of ['intent', 'intent_source'] as const) {
    const fieldValue = value[field];
    if (
      fieldValue !== undefined &&
      fieldValue !== null &&
      typeof fieldValue !== 'string'
    ) {
      throw new Error(`The handoff contains an unsupported ${field}`);
    }
  }
  const intent = readText(value.intent);
  if (intent && !BLOG_INTENTS.some((allowed) => allowed === intent)) {
    throw new Error('The handoff contains an unsupported intent');
  }

  const metadata = {
    title,
    author_name: readText(value.author_name) || 'Baci Editorial',
    slug: readText(value.slug) || generateSlug(title),
    featured_image_alt: readText(featuredImage.alt),
    focus_keyword: readText(value.focus_keyword),
    seo_title: readText(value.seo_title),
    seo_description: readText(value.seo_description),
    excerpt: readText(value.excerpt),
    category: readText(value.category),
    intent_source: readText(value.intent_source) || null,
  };
  const validatedMetadata = blogPostSchema
    .pick({
      title: true,
      author_name: true,
      slug: true,
      featured_image_alt: true,
      focus_keyword: true,
      seo_title: true,
      seo_description: true,
      excerpt: true,
      category: true,
      intent_source: true,
    })
    .safeParse(metadata);
  if (!validatedMetadata.success) {
    throw new Error(
      validatedMetadata.error.issues[0]?.message || 'Invalid handoff metadata'
    );
  }

  return {
    ...validatedMetadata.data,
    // API metadata may be nullable/optional; controlled form fields need strings.
    author_name: validatedMetadata.data.author_name ?? 'Baci Editorial',
    category: validatedMetadata.data.category ?? '',
    excerpt: validatedMetadata.data.excerpt ?? '',
    featured_image_alt: validatedMetadata.data.featured_image_alt ?? '',
    focus_keyword: validatedMetadata.data.focus_keyword ?? '',
    seo_description: validatedMetadata.data.seo_description ?? '',
    seo_title: validatedMetadata.data.seo_title ?? '',
    slug:
      validatedMetadata.data.slug ?? generateSlug(validatedMetadata.data.title),
    content,
    featured_image_height: readDimension(featuredImage.height),
    featured_image_url: featuredImageUrl,
    featured_image_variants: imageVariants,
    featured_image_width: readDimension(featuredImage.width),
    intent: intent ? (intent as BlogIntent) : null,
    status: 'draft',
    tags: tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .join(', '),
  };
}

const DECIMAL_DIMENSION_PATTERN = /^\d+$/u;

function readDimension(value: unknown): number | null {
  const coerced =
    typeof value === 'string' && DECIMAL_DIMENSION_PATTERN.test(value.trim())
      ? Number(value)
      : value;
  const result = blogPostSchema.shape.featured_image_width.safeParse(coerced);
  return result.success ? (result.data ?? null) : null;
}
