import type { BlogIntent } from '@/config/blog-intent';

export type PlatformAdminBlogStatus = 'draft' | 'published' | 'archived';

export type PlatformAdminBlogPostSummary = {
  id: string;
  published_at: string | null;
  slug: string;
  status: PlatformAdminBlogStatus;
  title: string;
  updated_at?: string | null;
};

export type PlatformAdminBlogPostDetail = PlatformAdminBlogPostSummary & {
  author_name: string | null;
  category: string | null;
  content: string | null;
  excerpt: string | null;
  featured_image_alt: string | null;
  featured_image_height: number | null;
  featured_image_url: string | null;
  featured_image_variants: Record<string, unknown> | null;
  featured_image_width: number | null;
  seo_description: string | null;
  seo_title: string | null;
  intent?: BlogIntent | null;
  intent_source?: string | null;
  focus_keyword?: string | null;
  tags?: string[] | null;
};

export type PlatformAdminBlogFormState = {
  author_name: string;
  category: string;
  content: string;
  excerpt: string;
  featured_image_alt: string;
  // True once the alt field is hand-edited after the current URL was set.
  // The save pipeline uses this — never the text being non-empty — to tell
  // fresh alt text from a stale description the URL change orphaned.
  featured_image_alt_edited?: boolean;
  featured_image_height: number | null;
  featured_image_url: string;
  featured_image_variants: Record<string, unknown>;
  featured_image_width: number | null;
  seo_description: string;
  seo_title: string;
  slug: string;
  status: PlatformAdminBlogStatus;
  tags: string;
  title: string;
  intent?: BlogIntent | null;
  intent_source?: string | null;
  focus_keyword?: string | null;
};

export const DEFAULT_PLATFORM_BLOG_FORM_STATE: PlatformAdminBlogFormState = {
  author_name: 'Baci Editorial',
  category: '',
  content: '',
  excerpt: '',
  featured_image_alt: '',
  featured_image_alt_edited: false,
  featured_image_height: null,
  featured_image_url: '',
  featured_image_variants: {},
  featured_image_width: null,
  seo_description: '',
  seo_title: '',
  slug: '',
  status: 'draft',
  tags: '',
  title: '',
};
