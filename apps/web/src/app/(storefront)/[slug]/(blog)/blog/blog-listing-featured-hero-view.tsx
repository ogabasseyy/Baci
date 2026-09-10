import { BlogFeaturedStory } from '@/components/storefront/ogabassey/pages/blog-featured-story';
import type { BlogPostData } from '@/templates/registry';

interface BlogListingFeaturedHeroViewProps {
  basePath: string;
  featuredPost: BlogPostData;
  imageSrc: string;
  publishedDateLabel: string;
}

export function BlogListingFeaturedHeroView({
  basePath,
  featuredPost,
  imageSrc,
  publishedDateLabel,
}: BlogListingFeaturedHeroViewProps) {
  return (
    <div className="bg-gray-50 px-4 pt-8 md:px-6 md:pt-12">
      <div className="mx-auto max-w-[1400px]">
        <BlogFeaturedStory
          basePath={basePath}
          featuredPost={featuredPost}
          imageSrc={imageSrc}
          publishedDateLabel={publishedDateLabel}
        />
      </div>
    </div>
  );
}
