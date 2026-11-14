import { getRequestScopedBlogPost } from '@/lib/cached-data';
import { getLiveBlogPost } from '@/lib/live-blog-post';

type ResolvedBlogPost = Awaited<ReturnType<typeof getLiveBlogPost>>;

export async function getResolvedBlogPost(
  slug: string,
  postSlug: string,
  isDraftMode: boolean
): Promise<ResolvedBlogPost> {
  if (isDraftMode) {
    return getLiveBlogPost(slug, postSlug, true);
  }

  try {
    // Request-scoped (React cache()) — reuses the same Promise generateMetadata
    // and the hero-shell resolver already awaited for this identifier/postSlug/
    // includeDrafts tuple instead of a second Supabase round-trip.
    const cachedData = await getRequestScopedBlogPost(
      slug,
      postSlug,
      isDraftMode
    );

    if (cachedData) {
      return cachedData;
    }
  } catch (error) {
    console.error(
      'Error fetching cached blog post, falling back to live query',
      {
        slug,
        postSlug,
        error,
      }
    );
  }

  return getLiveBlogPost(slug, postSlug, isDraftMode);
}
