import { ArrowRight, Calendar, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_CARD_IMAGE_SIZES,
} from '@/components/storefront/ogabassey/config/blog-media';
import { asRoute } from '@/lib/routes';
import type { BlogPostData } from '@/templates/registry';

interface BlogPostCardProps {
  href: string;
  imageSrc: string;
  post: BlogPostData;
  publishedDateLabel: string;
}

/**
 * Grid article card for the Ogabassey storefront blog listing.
 *
 * Uses a stretched link on the card heading so `next/link` does not serialize
 * the entire `<article>` subtree inside `__next_f` props.
 */
export function BlogPostCard({
  href,
  imageSrc,
  post,
  publishedDateLabel,
}: BlogPostCardProps) {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-all duration-300 focus-within:ring-2 focus-within:ring-red-600 hover:-translate-y-1 hover:shadow-xl">
      <div className="relative h-64 overflow-hidden">
        <Image
          src={imageSrc}
          alt={post.title}
          className="object-cover transition-transform duration-700 group-hover:scale-110"
          fill
          sizes={BLOG_LISTING_CARD_IMAGE_SIZES}
          loading="lazy"
          fetchPriority="low"
          quality={BLOG_HERO_IMAGE_QUALITY}
        />
        {post.category && (
          <div className="absolute top-4 left-4 rounded border border-gray-100 bg-white/95 px-3 py-1 font-black text-gray-900 text-xs uppercase tracking-wider shadow-sm backdrop-blur-md">
            {post.category}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-4 flex items-center gap-4 font-bold text-gray-400 text-xs uppercase tracking-wider">
          <span className="flex items-center gap-1">
            <Calendar size={12} className="text-red-500" />
            <time dateTime={post.published_at}>{publishedDateLabel}</time>
          </span>
          <span className="size-1 rounded-full bg-gray-300" />
          <span>{post.reading_time_minutes || 3} MIN READ</span>
        </div>
        <h2 className="mb-3 font-black text-gray-900 text-xl leading-tight line-clamp-2 transition-colors group-hover:text-red-600 md:text-2xl">
          <Link
            href={asRoute(href)}
            prefetch={false}
            className="after:absolute after:inset-0 after:z-10 focus-visible:outline-hidden"
          >
            {post.title}
          </Link>
        </h2>
        <p className="mb-6 flex-1 text-gray-500 text-sm leading-relaxed line-clamp-3 md:text-base">
          {post.excerpt}
        </p>
        <div className="mt-auto flex items-center justify-between border-gray-50 border-t pt-6">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-gray-500">
              <User size={14} />
            </div>
            <span className="font-bold text-gray-700 text-xs">
              {post.author_name || 'Ogabassey Team'}
            </span>
          </div>
          <span className="text-red-600 transition-transform group-hover:translate-x-1 group-hover:text-red-700">
            <ArrowRight size={20} />
          </span>
        </div>
      </div>
    </article>
  );
}
