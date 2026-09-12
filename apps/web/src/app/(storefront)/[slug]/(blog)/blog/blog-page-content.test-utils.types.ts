import type React from 'react';

export interface MockDefaultBlogUiProps {
  blogSchema: {
    publisher?: {
      '@id'?: string;
    };
    blogPost?: unknown;
  };
  itemListSchema?: {
    '@type'?: string;
    numberOfItems?: number;
    url?: string;
    itemListElement?: Array<{
      '@type'?: string;
      position?: number;
      url?: string;
      name?: string;
    }>;
  };
  categories: string[];
  categoryGuide?: React.ReactNode;
  merchant: { business_name: string };
  posts: Array<{ featured?: boolean; slug: string; title: string }>;
  totalPosts: number;
  currentPage?: number;
}

export interface MockTemplateBlogRendererProps {
  BlogComponent?: React.ComponentType<{
    categories?: Array<{ name: string; slug: string }>;
    category?: string;
    hideFeaturedStory?: boolean;
    posts?: MockDefaultBlogUiProps['posts'];
    searchQuery?: string;
    storeSlug?: string;
  }>;
  basePath?: string;
  blogPosts?: MockDefaultBlogUiProps['posts'];
  categories?: Array<{ name: string; slug: string }>;
  categoryGuide?: React.ReactNode;
  category?: string;
  hideFeaturedStory?: boolean;
  itemListSchema?: MockDefaultBlogUiProps['itemListSchema'];
  searchQuery?: string;
}
