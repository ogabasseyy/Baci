import type { PublishedClusterPost } from './content-cluster-types';

export function isPublishedClusterPost(
  value: unknown
): value is PublishedClusterPost {
  if (!value || typeof value !== 'object') return false;
  const post = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  const nullableStrings = (v: unknown) =>
    v === null ||
    (Array.isArray(v) && v.every((item) => typeof item === 'string'));
  const nullableNumber = (v: unknown) =>
    v === null || (typeof v === 'number' && Number.isFinite(v));
  return (
    typeof post.slug === 'string' &&
    post.slug.trim() !== '' &&
    typeof post.title === 'string' &&
    post.title.trim() !== '' &&
    nullableString(post.excerpt) &&
    nullableString(post.category) &&
    nullableStrings(post.tags) &&
    nullableStrings(post.keywords) &&
    nullableString(post.featured_image_url) &&
    nullableString(post.published_at) &&
    nullableNumber(post.reading_time_minutes)
  );
}
