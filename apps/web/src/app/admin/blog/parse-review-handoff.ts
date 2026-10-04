import { generateSlug } from '@/lib/blog-utils';
import type { PlatformAdminBlogFormState } from './blog-types';

export const MAX_REVIEW_HANDOFF_CONTENT_LENGTH = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseReviewHandoff(value: unknown): PlatformAdminBlogFormState {
  if (
    !isRecord(value) ||
    value.schema_version !== 'baci-blog-review-handoff/v1'
  ) {
    throw new Error('Unsupported review handoff format');
  }

  const title = readText(value.title);
  const content = readText(value.content_html);
  if (!title || !content) {
    throw new Error('A title and article content are required');
  }
  if (content.length > MAX_REVIEW_HANDOFF_CONTENT_LENGTH) {
    throw new Error('Article content exceeds the import limit');
  }
  if (/\{\{\s*INLINE_IMAGE_[1-3]\s*\}\}/u.test(content)) {
    throw new Error('The article has unresolved inline image placeholders');
  }

  const featuredImage = isRecord(value.featured_image)
    ? value.featured_image
    : {};
  const featuredImageUrl = readText(featuredImage.url);
  if (!isPublicHttpsUrl(featuredImageUrl)) {
    throw new Error('A public featured-image URL is required');
  }

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const imageVariantKeys = new Set([
    'square_1x1',
    'standard_4x3',
    'landscape_16x9',
  ]);
  const imageVariants = isRecord(featuredImage.variants)
    ? Object.fromEntries(
        Object.entries(featuredImage.variants).filter(
          (entry): entry is [string, string] =>
            imageVariantKeys.has(entry[0]) && isPublicHttpsUrl(entry[1])
        )
      )
    : {};
  const intent = readText(value.intent);
  const allowedIntents = new Set([
    'news',
    'comparison',
    'repair-guide',
    'buying-guide',
    'platform',
    'unknown',
  ]);
  if (intent && !allowedIntents.has(intent)) {
    throw new Error('The handoff contains an unsupported intent');
  }

  return {
    author_name: readText(value.author_name) || 'Baci Editorial',
    category: readText(value.category),
    content,
    excerpt: readText(value.excerpt),
    featured_image_alt: readText(featuredImage.alt),
    featured_image_height:
      typeof featuredImage.height === 'number' ? featuredImage.height : null,
    featured_image_url: featuredImageUrl,
    featured_image_variants: imageVariants,
    featured_image_width:
      typeof featuredImage.width === 'number' ? featuredImage.width : null,
    focus_keyword: readText(value.focus_keyword),
    intent: intent || 'unknown',
    intent_source: readText(value.intent_source) || 'unmapped_task_type',
    seo_description: readText(value.seo_description),
    seo_title: readText(value.seo_title),
    slug: readText(value.slug) || generateSlug(title),
    status: 'draft',
    tags: tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .join(', '),
    title,
  };
}
