import { getBlogAuthorSameAs } from '@/lib/blog-authors';
import {
  extractBlogFaqItems,
  generateFaqPageSchema,
} from '@/lib/blog-faq-schema';
import { buildBlogOrganizationId } from '@/lib/blog-organization-id';
import { buildBlogOrganizationSchema } from '@/lib/blog-organization-schema';
import { buildBlogPublisherSameAs } from '@/lib/blog-publisher-same-as';
import {
  getBlogStructuredDataImages,
  getBlogStructuredDataImageUrls,
} from '@/lib/blog-structured-data-images';
import { buildBlogVideoMetadata } from '@/lib/blog-video-metadata';
import { resolveBlogCatalogPrices } from '@/lib/resolve-blog-catalog-prices';
import {
  generateBlogPostSchema,
  generateBreadcrumbSchema,
} from '@/lib/seo-utils';
import { getBlogPostTextPreview } from './blog-post-content';

type BlogPostStructuredDataInput = {
  catalogPrices?: Parameters<typeof resolveBlogCatalogPrices>[1];
  author: {
    id?: string;
    image?: string;
    name: string;
    url: string;
  };
  baseUrl: string;
  blogIndexUrl: string;
  content: string;
  merchant: {
    business_name: string;
    country?: string | null;
    logo_url?: string | null;
    slug: string;
    social_media?: Record<string, unknown> | null;
  };
  post: {
    author_bio?: string | null;
    author_image_url?: string | null;
    author_name?: string | null;
    author_title?: string | null;
    category?: string | null;
    content?: unknown;
    excerpt?: string | null;
    featured_image_height?: number | null;
    featured_image_url?: string | null;
    featured_image_variants?: Record<string, unknown> | null;
    featured_image_width?: number | null;
    keywords?: string[] | null;
    published_at: string;
    reading_time_minutes?: number | null;
    seo_description?: string | null;
    seo_title?: string | null;
    title: string;
    updated_at?: string | null;
    videoUploadDate?: string | null;
    video_upload_date?: string | null;
    word_count?: number | null;
  };
  postUrl: string;
};

export function buildBlogPostStructuredData({
  catalogPrices,
  author,
  baseUrl,
  blogIndexUrl,
  content,
  merchant,
  post,
  postUrl,
}: BlogPostStructuredDataInput) {
  const organizationSchema = buildBlogOrganizationSchema(merchant, baseUrl);
  const organizationId =
    typeof organizationSchema['@id'] === 'string'
      ? organizationSchema['@id']
      : buildBlogOrganizationId(baseUrl);
  const blogImageUrls = getBlogStructuredDataImageUrls(post);
  const blogImages = getBlogStructuredDataImages(post);
  const resolvePriceText = (text: string) =>
    resolveBlogCatalogPrices({ html: text }, catalogPrices ?? { products: [] })
      .html ?? text;
  const faqSchema = generateFaqPageSchema(
    extractBlogFaqItems(content).map((item) => ({
      question: resolvePriceText(item.question),
      answer: resolvePriceText(item.answer),
    }))
  );
  const schemaDescription = resolvePriceText(
    post.seo_description || post.excerpt || getBlogPostTextPreview(post.content)
  );
  const title = post.seo_title || post.title;
  const videoMetadata = buildBlogVideoMetadata({
    authorName: author.name,
    content,
    description: schemaDescription,
    postUrl,
    publisherName: merchant.business_name,
    title,
    videoUploadDate: post.video_upload_date ?? post.videoUploadDate ?? null,
  });

  return {
    blogSchema: generateBlogPostSchema({
      title,
      description: schemaDescription,
      url: postUrl,
      ...(blogImages.length > 0 ? { imageObjects: blogImages } : {}),
      ...(blogImageUrls.length > 0 ? { imageUrls: blogImageUrls } : {}),
      datePublished: post.published_at,
      dateModified: post.updated_at ?? undefined,
      author: {
        name: author.name,
        id: author.id,
        url: author.url,
        jobTitle: post.author_title ?? undefined,
        description: post.author_bio ?? undefined,
        sameAs: post.author_name
          ? getBlogAuthorSameAs(post.author_name, merchant.slug)
          : [],
        image: author.image,
      },
      publisher: {
        id: organizationId,
        name: merchant.business_name,
        logo: merchant.logo_url || `${baseUrl}/logo.png`,
        url: baseUrl,
        sameAs: buildBlogPublisherSameAs(
          merchant.social_media,
          merchant.business_name
        ),
      },
      wordCount: post.word_count ?? undefined,
      keywords: post.keywords ?? undefined,
      category: post.category ?? undefined,
      readingTime: post.reading_time_minutes ?? undefined,
      blogId: `${blogIndexUrl}#blog`,
    }),
    breadcrumbSchema: generateBreadcrumbSchema([
      {
        name: merchant.business_name,
        url: baseUrl,
      },
      {
        name: 'Blog',
        url: blogIndexUrl,
      },
      {
        name: post.title,
        url: postUrl,
      },
    ]),
    faqSchema,
    organizationSchema,
    videoMetadata,
  };
}
