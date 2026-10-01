import type { TemplatePageProps } from './template-page-props';

/** Blog post data structure for template components. */
export interface BlogPostData {
  id: string | number;
  title: string;
  excerpt: string;
  category: string;
  author_name: string;
  published_at: string;
  featured_image_url: string;
  reading_time_minutes: number;
  slug: string;
  featured?: boolean;
}

/** Props for blog page components. */
export interface TemplateBlogPageProps extends TemplatePageProps {
  posts?: BlogPostData[];
  categories?: { name: string; slug: string }[];
  /** Current category query if filtering by category */
  category?: string;
  /** Current search query if filtering by search */
  searchQuery?: string;
  /** Set when the listing hero/LCP image is rendered outside this component. */
  hideFeaturedStory?: boolean;
}
