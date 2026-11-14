import type { JsonLdStructuredData } from '@/lib/json-ld-types';
import { generateStorefrontSlug } from './generate-storefront-slug';
import { escapeHtml } from './sanitize-core';
import { sanitizeSchemaUrl } from './sanitize-json-ld';

/**
 * Blog Post Schema Data
 */
export interface BlogPostSchemaData {
  title: string;
  description: string;
  url: string;
  image?: string;
  imageUrls?: string[];
  imageObjects?: Array<{
    '@type'?: 'ImageObject';
    url: string;
    width?: number;
    height?: number;
  }>;
  datePublished: string;
  dateModified?: string;
  author: {
    type?: 'Person' | 'Organization';
    name: string;
    id?: string;
    url?: string;
    jobTitle?: string;
    description?: string;
    sameAs?: readonly unknown[];
    image?: string;
  };
  publisher: {
    id?: string;
    name: string;
    logo: string;
    url: string;
    sameAs?: readonly unknown[];
  };
  wordCount?: number;
  keywords?: string[];
  category?: string;
  readingTime?: number;
  blogId?: string;
}

function sanitizeSchemaEntityId(id: string): string {
  const trimmed = id.trim();
  const sanitized = sanitizeSchemaUrl(trimmed);
  if (!sanitized) {
    return '';
  }

  return trimmed.includes('/#')
    ? sanitized
    : sanitized.replace(/\/(#.+)$/, '$1');
}

function normalizeBlogAuthorSameAs(
  sameAs: readonly unknown[] | undefined
): string[] {
  if (!sameAs) {
    return [];
  }

  return [
    ...new Set(
      sameAs
        .filter((url): url is string => typeof url === 'string')
        .map((url) => sanitizeSchemaUrl(url.trim()))
        .filter((url) => url.length > 0)
    ),
  ];
}

/**
 * Generate Blog Post Schema (Article)
 */
export function generateBlogPostSchema(
  data: BlogPostSchemaData
): JsonLdStructuredData {
  // SECURITY FIX: Sanitize all inputs to prevent XSS (consistent with other schema functions)
  const authorSameAs = normalizeBlogAuthorSameAs(data.author.sameAs);
  const publisherSameAs = normalizeBlogAuthorSameAs(data.publisher.sameAs);
  const authorId = data.author.id
    ? sanitizeSchemaEntityId(data.author.id)
    : data.author.url
      ? sanitizeSchemaEntityId(
          `${data.author.url}#author-${generateStorefrontSlug(data.author.name)}`
        )
      : '';
  const publisherId = data.publisher.id
    ? sanitizeSchemaEntityId(data.publisher.id)
    : '';
  const blogId = data.blogId ? sanitizeSchemaEntityId(data.blogId) : '';
  const authorImage = data.author.image
    ? sanitizeSchemaUrl(data.author.image.trim())
    : '';
  const authorType = data.author.type ?? 'Person';
  const schema: JsonLdStructuredData = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: escapeHtml(data.title),
    description: escapeHtml(data.description),
    url: escapeHtml(data.url),
    datePublished: data.datePublished,
    dateModified: data.dateModified || data.datePublished,
    author: {
      '@type': authorType,
      ...(authorId && {
        '@id': escapeHtml(authorId),
      }),
      name: escapeHtml(data.author.name),
      ...(data.author.url && { url: escapeHtml(data.author.url) }),
      ...(authorType === 'Person' &&
        data.author.jobTitle && {
          jobTitle: escapeHtml(data.author.jobTitle),
        }),
      ...(data.author.description && {
        description: escapeHtml(data.author.description),
      }),
      ...(authorType === 'Person' &&
        authorSameAs.length > 0 && {
          sameAs: authorSameAs,
        }),
      ...(authorImage && { image: escapeHtml(authorImage) }),
    },
    publisher: {
      '@type': 'Organization',
      ...(publisherId && { '@id': escapeHtml(publisherId) }),
      name: escapeHtml(data.publisher.name),
      url: escapeHtml(data.publisher.url),
      logo: {
        '@type': 'ImageObject',
        url: escapeHtml(data.publisher.logo),
      },
      ...(publisherSameAs.length > 0 && {
        sameAs: publisherSameAs,
      }),
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': escapeHtml(data.url),
    },
    ...(blogId && {
      isPartOf: {
        '@type': 'Blog',
        '@id': escapeHtml(blogId),
      },
    }),
  };

  const imageUrls = Array.isArray(data.imageUrls)
    ? data.imageUrls.map((url) => url.trim()).filter((url) => url.length > 0)
    : [];
  const imageObjects: Record<string, unknown>[] = Array.isArray(
    data.imageObjects
  )
    ? data.imageObjects.flatMap((image) => {
        const url = sanitizeSchemaUrl(image.url.trim());
        if (!url) {
          return [];
        }

        const width = image.width;
        const height = image.height;

        return [
          {
            '@type': 'ImageObject',
            url,
            ...(typeof width === 'number' &&
              Number.isInteger(width) &&
              width > 0 && { width }),
            ...(typeof height === 'number' &&
              Number.isInteger(height) &&
              height > 0 && { height }),
          },
        ];
      })
    : [];

  if (imageObjects.length > 0) {
    schema.image = imageObjects;
  } else if (imageUrls.length > 0) {
    schema.image = imageUrls.map((url) => escapeHtml(url));
  } else if (data.image) {
    schema.image = {
      '@type': 'ImageObject',
      url: escapeHtml(data.image),
    };
  }

  if (data.wordCount) {
    schema.wordCount = data.wordCount;
  }

  if (data.keywords && data.keywords.length > 0) {
    // Sanitize each keyword
    schema.keywords = data.keywords.map((k) => escapeHtml(k)).join(', ');
  }

  if (data.category) {
    schema.articleSection = escapeHtml(data.category);
  }

  if (data.readingTime) {
    schema.timeRequired = `PT${data.readingTime}M`;
  }

  return schema;
}
