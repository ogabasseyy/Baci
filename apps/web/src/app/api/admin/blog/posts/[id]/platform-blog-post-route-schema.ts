export type PlatformBlogRouteParams = {
  params: Promise<{ id: string }>;
};

export const PLATFORM_BLOG_DETAIL_SELECT =
  'id, title, slug, content, excerpt, featured_image_url, featured_image_alt, featured_image_width, featured_image_height, featured_image_variants, category, tags, keywords, author_name, author_title, author_image_url, author_bio, status, seo_title, seo_description, focus_keyword, word_count, reading_time_minutes, view_count, created_at, updated_at, published_at';
