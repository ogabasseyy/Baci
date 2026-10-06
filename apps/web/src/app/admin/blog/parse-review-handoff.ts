import { BLOG_INTENTS, type BlogIntent } from '@/config/blog-intent';
import { MAX_REVIEW_HANDOFF_CONTENT_LENGTH } from '@/config/blog-review-handoff';
import { validateBlogImageVariantIntegrity } from '@/lib/blog-discover-readiness';
import { generateSlug } from '@/lib/blog-utils';
import { isHttpsUrl } from '@/lib/is-https-url';
import { blogPostSchema } from '@/lib/validations/blog';
import type { PlatformAdminBlogFormState } from './blog-types';
import { validateImportedContent } from './review-handoff-content';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const NULL_BYTE = String.fromCharCode(0);

function readRawText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // PostgreSQL text rejects null bytes, so fail fast instead of importing a
  // draft that can never save.
  if (value.includes(NULL_BYTE)) {
    throw new Error('Imported text must not contain null bytes');
  }
  return value;
}

function readText(value: unknown): string {
  return readRawText(value).trim();
}

export function parseReviewHandoff(value: unknown): PlatformAdminBlogFormState {
  if (
    !isRecord(value) ||
    value.schema_version !== 'baci-blog-review-handoff/v1'
  ) {
    throw new Error('Unsupported review handoff format');
  }

  const title = readText(value.title);
  // Content keeps its original bytes into markdown rendering so leading
  // indentation (indented code blocks) survives; only the required/empty
  // check uses a trimmed copy.
  const rawContent = readRawText(value.content_html);
  if (!title || !rawContent.trim()) {
    throw new Error('A title and article content are required');
  }
  if (rawContent.length > MAX_REVIEW_HANDOFF_CONTENT_LENGTH) {
    throw new Error('Article content exceeds the import limit');
  }
  const content = validateImportedContent(rawContent);

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
            // URL parsing normalizes the path independently of the query, so
            // a null byte hiding in ?token=... would pass integrity and then
            // fail the database write; drop such variants instead.
            !entry[1].includes(NULL_BYTE) &&
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
    intent_source: intent ? readText(value.intent_source) || null : null,
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
