import { Tag } from 'lucide-react';
import { marked } from 'marked';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { BlogContentRenderer } from '@/components/blog/renderer/BlogContentRenderer';
import { TableOfContents } from '@/components/blog/table-of-contents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SafeHtml } from '@/components/ui/safe-html';
import { removeDuplicateLegacyFeaturedImage } from '@/lib/blog-legacy-featured-image-dedupe';

export interface BlogPostBodyProps {
  basePath: string;
  baseUrl: string;
  content: unknown;
  locale?: string;
  post: {
    author_bio?: string | null;
    id: string;
    slug: string;
    tags?: string[] | null;
    title: string;
    featured_image_url?: string | null;
  };
  relatedProducts?: Array<{
    category_slug?: string | null;
    id: string;
    name: string;
    slug?: string | null;
  }>;
  relatedPosts: Array<{
    category?: string | null;
    featured_image_url?: string | null;
    id: string;
    published_at?: string | null;
    reading_time_minutes?: number | null;
    slug: string;
    title: string;
  }>;
}

const EMPTY_RELATED_PRODUCTS: NonNullable<
  BlogPostBodyProps['relatedProducts']
> = [];

export async function BlogPostBody({
  basePath,
  baseUrl,
  content,
  locale,
  post,
  relatedProducts = EMPTY_RELATED_PRODUCTS,
  relatedPosts,
}: BlogPostBodyProps) {
  const contentStr =
    typeof content === 'string' ? content : JSON.stringify(content);
  const trimmedContent = contentStr.trim();
  const isJson =
    (trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
    !trimmedContent.startsWith('<');
  const isHtml = !isJson && trimmedContent.startsWith('<');

  let legacyHtml = '';
  if (!isJson) {
    legacyHtml = isHtml ? contentStr : await marked(contentStr);
  }

  const postUrl = `${baseUrl}${basePath}/blog/${post.slug}`;
  const safeRelatedProducts = relatedProducts.flatMap((product) => {
    const name = typeof product.name === 'string' ? product.name.trim() : '';
    const slug = typeof product.slug === 'string' ? product.slug.trim() : '';
    const categorySlug =
      typeof product.category_slug === 'string'
        ? product.category_slug.trim()
        : '';

    if (!name || !slug) {
      return [];
    }

    return [
      {
        ...product,
        category_slug: categorySlug || null,
        name,
        slug,
      },
    ];
  });

  return (
    <div className="content-auto [contain-intrinsic-size:1152px_2400px]">
      {/* Table of Contents (auto-generated from headings) */}
      {isJson && <TableOfContents />}

      {/* Post Content */}
      <div className="mb-8">
        {isJson ? (
          <BlogContentRenderer
            json={content}
            priorityInlineImageSrc={post.featured_image_url ? null : undefined}
          />
        ) : (
          <SafeHtml
            html={removeDuplicateLegacyFeaturedImage(
              legacyHtml,
              post.featured_image_url
            )}
            headingLevelOffset={1}
            normalizeSeoAnchors={true}
            className="prose dark:prose-invert prose-baci max-w-none w-full"
          />
        )}
      </div>

      {/* Tags */}
      {post.tags && post.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-8 pt-8 border-t">
          <Tag className="size-4 text-muted-foreground" />
          {post.tags.map((tag: string) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Share */}
      <div className="flex items-center gap-4 mb-12 pb-8 border-b">
        <span className="text-sm text-muted-foreground">
          Share this article:
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(postUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share on Twitter (opens in new tab)"
            >
              Twitter
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(postUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share on LinkedIn (opens in new tab)"
            >
              LinkedIn
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share on Facebook (opens in new tab)"
            >
              Facebook
            </a>
          </Button>
        </div>
      </div>

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-6">Related Articles</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {relatedPosts.map((related) => (
              <Link
                key={related.id}
                href={`${basePath}/blog/${related.slug}` as Route}
              >
                <Card className="h-full hover:shadow-lg transition-shadow group">
                  {related.featured_image_url && (
                    <div className="aspect-video overflow-hidden rounded-t-lg relative">
                      <Image
                        src={related.featured_image_url}
                        alt={related.title}
                        fill
                        sizes="(max-width: 768px) 100vw, 33vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  )}
                  <CardHeader>
                    {related.category && (
                      <Badge variant="secondary" className="w-fit mb-2">
                        {related.category}
                      </Badge>
                    )}
                    <CardTitle className="text-lg line-clamp-2 group-hover:text-primary transition-colors">
                      {related.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {related.published_at && (
                        <span>
                          {new Date(related.published_at).toLocaleDateString(
                            locale ?? 'en-NG',
                            {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            }
                          )}
                        </span>
                      )}
                      {related.reading_time_minutes && (
                        <span>{related.reading_time_minutes} min read</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {safeRelatedProducts.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-bold mb-4">
            Popular Products Mentioned
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {safeRelatedProducts.map((product) => {
              const categorySlug = product.category_slug;
              const href = categorySlug
                ? `${basePath}/${categorySlug}/${product.slug}`
                : `${basePath}/products/${product.slug}`;

              return (
                <li key={product.id}>
                  <Link
                    href={href as Route}
                    className="block rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    {product.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
