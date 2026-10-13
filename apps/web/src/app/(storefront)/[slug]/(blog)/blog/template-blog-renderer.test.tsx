import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TemplateBlogRenderer } from './template-blog-renderer';

describe('TemplateBlogRenderer', () => {
  const BLOG_SCHEMA = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
  } as const;

  const BREADCRUMB_SCHEMA = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
  } as const;

  const ORGANIZATION_SCHEMA = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: 'Ogabassey',
  } as const;

  const BlogComponent = ({
    storeSlug,
    posts,
    categories,
    category,
    searchQuery,
    hideFeaturedStory,
  }: {
    storeSlug?: string;
    posts?: Array<{ title: string }>;
    categories?: Array<{ name: string }>;
    category?: string;
    searchQuery?: string;
    hideFeaturedStory?: boolean;
  }) => (
    <div>
      <div data-testid="store-slug">{storeSlug}</div>
      <div data-testid="post-count">{posts?.length ?? 0}</div>
      <div data-testid="post-titles">
        {posts?.map((post) => post.title).join(',') ?? ''}
      </div>
      <div data-testid="categories">
        {categories?.map((category) => category.name).join(',') ?? ''}
      </div>
      <div data-testid="active-category">
        {category === undefined ? 'undefined' : category}
      </div>
      <div data-testid="search-query">
        {searchQuery === undefined ? 'undefined' : searchQuery}
      </div>
      <div data-testid="hide-featured-story">
        {hideFeaturedStory ? 'true' : 'false'}
      </div>
    </div>
  );

  it('renders the template blog component with structured data scripts', () => {
    const { container } = render(
      <TemplateBlogRenderer
        blogSchema={BLOG_SCHEMA}
        breadcrumbSchema={BREADCRUMB_SCHEMA}
        BlogComponent={BlogComponent}
        basePath="/ogabassey"
        blogPosts={[
          {
            id: 'post-1',
            title: 'First Post',
            excerpt: 'Excerpt',
            category: 'News',
            author_name: 'Oga',
            published_at: '2026-03-29T00:00:00.000Z',
            featured_image_url: '',
            reading_time_minutes: 3,
            slug: 'first-post',
          },
        ]}
        categories={[{ name: 'News', slug: 'news' }]}
        category="News"
        searchQuery="pixel"
      />
    );

    expect(screen.getByTestId('store-slug')).toHaveTextContent('/ogabassey');
    expect(screen.getByTestId('post-titles')).toHaveTextContent('First Post');
    expect(screen.getByTestId('categories')).toHaveTextContent('News');
    expect(screen.getByTestId('active-category')).toHaveTextContent('News');
    expect(screen.getByTestId('search-query')).toHaveTextContent('pixel');
    expect(screen.getByTestId('hide-featured-story')).toHaveTextContent(
      'false'
    );
    expect(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).toHaveLength(2);
  });

  it('renders no post entries when blogPosts is empty', () => {
    const { container } = render(
      <TemplateBlogRenderer
        blogSchema={BLOG_SCHEMA}
        breadcrumbSchema={BREADCRUMB_SCHEMA}
        BlogComponent={BlogComponent}
        basePath="/ogabassey"
        blogPosts={[]}
        categories={[]}
      />
    );

    expect(screen.getByTestId('post-count')).toHaveTextContent('0');
    expect(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).toHaveLength(2);
  });

  it('renders category guide copy after the template blog component', () => {
    render(
      <TemplateBlogRenderer
        blogSchema={BLOG_SCHEMA}
        breadcrumbSchema={BREADCRUMB_SCHEMA}
        BlogComponent={BlogComponent}
        basePath="/ogabassey"
        blogPosts={[]}
        categories={[]}
        categoryGuide={<section>Ogabassey review guide</section>}
      />
    );

    const templatePostCount = screen.getByTestId('post-count');
    const guide = screen.getByText('Ogabassey review guide');

    expect(guide).toBeInTheDocument();
    expect(
      templatePostCount.compareDocumentPosition(guide) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('passes an undefined search query through to the template component', () => {
    render(
      <TemplateBlogRenderer
        blogSchema={BLOG_SCHEMA}
        breadcrumbSchema={BREADCRUMB_SCHEMA}
        BlogComponent={BlogComponent}
        basePath="/ogabassey"
        blogPosts={[]}
        categories={[{ name: 'News', slug: 'news' }]}
      />
    );

    expect(screen.getByTestId('active-category')).toHaveTextContent(
      'undefined'
    );
    expect(screen.getByTestId('search-query')).toHaveTextContent('undefined');
    expect(screen.getByTestId('hide-featured-story')).toHaveTextContent(
      'false'
    );
  });

  it('forwards hideFeaturedStory to the template blog component', () => {
    render(
      <TemplateBlogRenderer
        blogSchema={BLOG_SCHEMA}
        breadcrumbSchema={BREADCRUMB_SCHEMA}
        BlogComponent={BlogComponent}
        basePath="/ogabassey"
        blogPosts={[]}
        categories={[]}
        hideFeaturedStory
      />
    );

    expect(screen.getByTestId('hide-featured-story')).toHaveTextContent('true');
  });

  it('renders multiple posts and categories', () => {
    const { container } = render(
      <TemplateBlogRenderer
        blogSchema={BLOG_SCHEMA}
        breadcrumbSchema={BREADCRUMB_SCHEMA}
        BlogComponent={BlogComponent}
        basePath="/ogabassey"
        blogPosts={[
          {
            id: 'post-1',
            title: 'First Post',
            excerpt: 'Excerpt',
            category: 'News',
            author_name: 'Oga',
            published_at: '2026-03-29T00:00:00.000Z',
            featured_image_url: '',
            reading_time_minutes: 3,
            slug: 'first-post',
          },
          {
            id: 'post-2',
            title: 'Second Post',
            excerpt: 'Excerpt',
            category: 'Tips',
            author_name: 'Oga',
            published_at: '2026-03-30T00:00:00.000Z',
            featured_image_url: '',
            reading_time_minutes: 4,
            slug: 'second-post',
          },
        ]}
        categories={[
          { name: 'News', slug: 'news' },
          { name: 'Tips', slug: 'tips' },
        ]}
        searchQuery="launch"
      />
    );

    expect(screen.getByTestId('post-count')).toHaveTextContent('2');
    expect(screen.getByTestId('post-titles')).toHaveTextContent(
      'First Post,Second Post'
    );
    expect(screen.getByTestId('categories')).toHaveTextContent('News,Tips');
    expect(screen.getByTestId('search-query')).toHaveTextContent('launch');
    expect(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).toHaveLength(2);
  });

  it('renders the Organization entity script when an organizationSchema is provided', () => {
    const { container } = render(
      <TemplateBlogRenderer
        blogSchema={BLOG_SCHEMA}
        breadcrumbSchema={BREADCRUMB_SCHEMA}
        organizationSchema={ORGANIZATION_SCHEMA}
        BlogComponent={BlogComponent}
        basePath="/ogabassey"
        blogPosts={[]}
        categories={[]}
      />
    );

    const scripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    expect(scripts).toHaveLength(3);
    expect(
      Array.from(scripts).some((script) =>
        script.textContent?.includes('OnlineStore')
      )
    ).toBe(true);
  });
});
