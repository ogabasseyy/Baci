import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CdnFormatImage } from '@/components/storefront/cdn-format-image';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_POST_HERO_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/blog-media';
import { Button } from '@/components/ui/button';
import { asRoute } from '@/lib/routes';
import { BlogPostHeader, type BlogPostHeaderProps } from './BlogPostHeader';

interface BlogPostHero {
  alt: string;
  src: string;
}

interface BlogPostShellProps {
  /** `${basePath}/blog` — powers the breadcrumb and footer "back" links. */
  blogHref: string;
  /** Rendered before the page chrome (draft banner, JSON-LD, view counter). */
  beforeChrome?: ReactNode;
  header: BlogPostHeaderProps;
  hero: BlogPostHero | null;
  /** Streams inside the article, below the hero + header. */
  children: ReactNode;
}

/**
 * Static page chrome for a blog post: breadcrumb, article card, hero image, and
 * post header. Rendering the hero + `<h1>` here — outside the data Suspense that
 * streams the article body — puts the LCP image inside the prerendered shell so
 * the browser can discover and paint it without waiting on the dynamic subtree.
 *
 * The hero uses `preload` only (no `loading`/`fetchPriority`) to match the
 * repo's LCP convention in `components/optimized-image.tsx`.
 */
export function BlogPostShell({
  blogHref,
  beforeChrome,
  header,
  hero,
  children,
}: BlogPostShellProps) {
  return (
    <>
      {beforeChrome}
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-background">
          <div className="container mx-auto px-4 py-4">
            <Link
              href={asRoute(blogHref)}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to Blog
            </Link>
          </div>
        </div>

        <main className="container mx-auto px-4 py-8">
          <article className="max-w-6xl mx-auto bg-card text-card-foreground rounded-3xl p-6 md:p-10 md:px-12 shadow-sm border border-border overflow-hidden">
            {hero && (
              <div className="aspect-video rounded-2xl overflow-hidden mb-8 relative bg-muted">
                {/* Explicit per-format `<picture>` (AVIF `<source>` + jpeg/png
                    `<img>` fallback) for the blog post LCP hero. Cloudflare Free
                    ignores `Vary: Accept`, so a single `format=auto` URL would
                    serve non-AVIF browsers undecodable bytes. `preload` keeps the
                    repo LCP convention: for CDN heroes it fires the AVIF hint
                    (byte-identical to `preloadOgabasseyBlogPostHeroResources`, so
                    they dedupe); for non-CDN heroes — which the resource-hints
                    module skips — it fires the plain fallback hint next/image's
                    `preload` prop used to emit. */}
                <CdnFormatImage
                  src={hero.src}
                  alt={hero.alt}
                  fill
                  className="object-cover"
                  preload
                  sizes={BLOG_POST_HERO_IMAGE_SIZES}
                  quality={BLOG_HERO_IMAGE_QUALITY}
                />
              </div>
            )}

            <BlogPostHeader {...header} />

            {children}
          </article>
        </main>

        <footer className="border-t py-8">
          <div className="container mx-auto px-4 text-center">
            <Link href={asRoute(blogHref)}>
              <Button variant="outline">
                <ArrowLeft className="size-4 mr-2" />
                Back to all articles
              </Button>
            </Link>
          </div>
        </footer>
      </div>
    </>
  );
}
