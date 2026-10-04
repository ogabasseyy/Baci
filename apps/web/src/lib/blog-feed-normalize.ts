import { stripInvalidXml10Characters } from './sanitize-xml-10';

interface BlogFeedFilterablePost {
  title: string;
  category: string | null;
}

/**
 * Strips XML-forbidden characters from feed fields that double as
 * visibility-filter inputs. Call on fetched rows BEFORE filterPublicBlogPosts
 * so the predicate evaluates the same text the feed renders — otherwise a
 * control character can split a blocked prefix (e.g. `te<U+001A>st post`)
 * and sneak test content past the filter.
 *
 * The slug is intentionally left raw: feed links percent-encode it with
 * encodeURIComponent at emission, which preserves record identity and stays
 * XML-safe without deleting characters from URLs.
 */
export function normalizeBlogFeedPostForFilter<
  T extends BlogFeedFilterablePost,
>(post: T): T {
  return {
    ...post,
    title: stripInvalidXml10Characters(post.title),
    category:
      post.category === null
        ? null
        : stripInvalidXml10Characters(post.category),
  };
}
