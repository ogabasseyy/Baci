export function buildCommercialGuideDescription(post: {
  excerpt: string | null;
  reading_time_minutes: number | null;
}) {
  const excerpt = post.excerpt?.trim();

  if (excerpt) {
    return excerpt;
  }

  return post.reading_time_minutes
    ? `${post.reading_time_minutes} minute guide`
    : 'Read the full guide';
}
