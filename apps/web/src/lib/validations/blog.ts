import z from 'zod';
import { sanitizeHtml } from '@/lib/sanitize';

const featuredImageVariantsSchema = z
  .object({
    square_1x1: z.url().optional(),
    standard_4x3: z.url().optional(),
    landscape_16x9: z.url().optional(),
  })
  .strict();

const featuredImageDimensionSchema = z
  .number()
  .int()
  .positive()
  .nullable()
  .optional();

const embeddedProductIdsSchema = z
  .array(z.uuid('Embedded product IDs must be valid UUIDs'))
  .max(20, 'A post can embed at most 20 products')
  .superRefine((productIds, context) => {
    if (new Set(productIds).size !== productIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Embedded products must not contain duplicate IDs',
      });
    }
  });

export const blogPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long'),
  slug: z
    .string()
    .min(1, 'Slug cannot be empty')
    .max(200, 'Slug is too long')
    .regex(
      /^[a-z0-9-]+$/,
      'Slug must contain only lowercase letters, numbers, and hyphens'
    )
    .optional(),
  content: z.string().min(1, 'Content cannot be empty').optional(),
  excerpt: z.string().max(300, 'Excerpt is too long').optional().nullable(),
  featured_image_url: z.url().optional().nullable().or(z.literal('')),
  featured_image_width: featuredImageDimensionSchema,
  featured_image_height: featuredImageDimensionSchema,
  featured_image_variants: featuredImageVariantsSchema.optional(),
  featured_image_alt: z.string().max(200).optional().nullable(),
  intent: z
    .enum([
      'news',
      'comparison',
      'repair-guide',
      'buying-guide',
      'platform',
      'unknown',
    ])
    .optional()
    .nullable(),
  intent_source: z.string().max(100).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  tags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  author_name: z
    .string()
    .min(1, 'Author name cannot be empty')
    .max(100)
    .optional(),
  author_title: z.string().max(100).optional().nullable(),
  author_image_url: z.url().optional().nullable().or(z.literal('')),
  author_bio: z.string().max(500).optional().nullable(),
  // Note: 'scheduled' exists in the DB enum but has no cron job to publish.
  // Only accept statuses that are immediately actionable.
  status: z.enum(['draft', 'published', 'archived']).optional(),
  published_at: z.iso.datetime({ offset: true }).nullable().optional(),
  seo_title: z
    .string()
    .max(70, 'SEO title must be 70 characters or less')
    .optional()
    .nullable(),
  seo_description: z
    .string()
    .max(160, 'Meta description must be 160 characters or less')
    .optional()
    .nullable(),
  focus_keyword: z
    .string()
    .max(50, 'Focus keyword must be 50 characters or less')
    .optional()
    .nullable(),
  embedded_products: embeddedProductIdsSchema.optional(),
});

/**
 * Schema for creating a new post.
 * More strict than the general update schema.
 */
export const createPostSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  content: z.string().min(1, 'Content is required'),
  excerpt: z.string().max(300).optional(),
  featured_image_url: z.url().optional().nullable(),
  featured_image_width: featuredImageDimensionSchema,
  featured_image_height: featuredImageDimensionSchema,
  featured_image_variants: featuredImageVariantsSchema.optional(),
  featured_image_alt: z.string().max(200).optional(),
  intent: z
    .enum([
      'news',
      'comparison',
      'repair-guide',
      'buying-guide',
      'platform',
      'unknown',
    ])
    .optional(),
  intent_source: z.string().max(100).optional(),
  category: z.string().max(100).optional(),
  tags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  author_name: z.string().min(1, 'Author name is required').max(100),
  author_title: z.string().max(100).optional(),
  author_image_url: z.url().optional().nullable(),
  author_bio: z.string().max(500).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  seo_title: z.string().max(70).optional(),
  seo_description: z.string().max(160).optional(),
  focus_keyword: z.string().max(50).optional(),
  embedded_products: embeddedProductIdsSchema.optional(),
});

export type BlogPostInput = z.infer<typeof blogPostSchema>;

/**
 * Sanitizes blog post data for API consumption.
 * 2026 Best Practice: Centralized data cleaning before validation.
 */
export function sanitizeBlogPostData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const shouldClearFeaturedImageMetadata =
    Object.hasOwn(data, 'featured_image_url') &&
    (data.featured_image_url === null ||
      (typeof data.featured_image_url === 'string' &&
        data.featured_image_url.trim() === ''));

  for (const [key, value] of Object.entries(data)) {
    if (
      shouldClearFeaturedImageMetadata &&
      (key === 'featured_image_width' || key === 'featured_image_height')
    ) {
      sanitized[key] = null;
      continue;
    }

    if (key === 'featured_image_variants') {
      sanitized[key] = shouldClearFeaturedImageMetadata
        ? {}
        : value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : {};
      continue;
    }

    // 1. Handle special cases for tags/keywords array conversion (must come before generic string handler)
    if ((key === 'tags' || key === 'keywords') && typeof value === 'string') {
      sanitized[key] = value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
    }
    // 2. Handle generic strings: convert empty to null or undefined
    else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        const nullableFields = [
          'featured_image_url',
          'featured_image_alt',
          'excerpt',
          'category',
          'author_title',
          'author_bio',
          'author_image_url',
          'seo_title',
          'seo_description',
          'focus_keyword',
        ];
        sanitized[key] = nullableFields.includes(key) ? null : undefined;
      } else {
        // Sanitize HTML for user-generated content fields to prevent XSS
        const htmlFields = ['content', 'excerpt', 'author_bio'];
        sanitized[key] = htmlFields.includes(key)
          ? sanitizeHtml(trimmed)
          : trimmed;
      }
    }
    // 3. Handle existing arrays: remove empty/whitespace items
    else if (Array.isArray(value)) {
      sanitized[key] = value
        .filter((item) => item !== null && item !== undefined)
        .map((item) => (typeof item === 'string' ? item.trim() : item))
        .filter((item) => item !== '');
    }
    // 4. Passthrough other types
    else {
      sanitized[key] = value;
    }
  }

  if (shouldClearFeaturedImageMetadata) {
    sanitized.featured_image_width = null;
    sanitized.featured_image_height = null;
    sanitized.featured_image_variants = {};
  }

  return sanitized;
}
