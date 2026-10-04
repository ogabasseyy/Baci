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
  intent?: string | null;
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
  intent?: string | null;
  intent_source?: string | null;
  focus_keyword?: string;
};

export const DEFAULT_PLATFORM_BLOG_FORM_STATE: PlatformAdminBlogFormState = {
  author_name: 'Baci Editorial',
  category: '',
  content: '',
  excerpt: '',
  featured_image_alt: '',
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
