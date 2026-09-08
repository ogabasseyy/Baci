import { isOgabasseyBlogStaticTenant } from './blog-category-routing';
import { BlogListingStaticHero } from './blog-listing-static-hero';
import { BlogPageContent, type BlogPageProps } from './blog-page-content';

export async function BlogListingRequestContent({
  params,
  searchParams,
}: BlogPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const isRootListing =
    isOgabasseyBlogStaticTenant(slug) &&
    !['category', 'page', 'search'].some((key) => query[key] !== undefined);
  const hero = isRootListing ? await BlogListingStaticHero({ params }) : null;

  // The same resolved request chooses both the external hero and suppression.
  // A null hero must never hide a story from the request-specific template.
  return (
    <>
      {hero}
      <BlogPageContent
        params={params}
        searchParams={searchParams}
        hideFeaturedStory={hero !== null}
      />
    </>
  );
}
