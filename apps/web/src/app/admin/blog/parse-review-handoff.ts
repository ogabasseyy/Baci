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

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
      for (const candidate of value.split(',')) {
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

function hasReadableContent(content: string): boolean {
  if (content.match(MEDIA_TAG_PATTERN)) return true;
  const text = content
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/gi, ' ')
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
  const content = sanitizeHtml(rawContent);
  if (!content.trim()) {
    throw new Error('Article content is empty after sanitization');
  }
  if (/^[[{]/u.test(content.trimStart())) {
    throw new Error(
      'Article content must be HTML, not JSON-shaped text. Wrap literal JSON examples in HTML.'
    );
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

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
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

function readDimension(value: unknown): number | null {
  const result = blogPostSchema.shape.featured_image_width.safeParse(value);
  return result.success ? (result.data ?? null) : null;
}
