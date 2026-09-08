import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import './blog-page-content.test-utils';
import BlogPage, { generateStaticParams } from './page';

describe('blog page shell', () => {
  it('generates static params for both monitored tenant identifiers', () => {
    expect(generateStaticParams()).toEqual([
      { slug: 'ogabassey.com' },
      { slug: 'ogabassey' },
    ]);
  });

  it('keeps request reads inside the loading boundary', () => {
    const then = vi.fn(() => {
      throw new Error('request read outside boundary');
    });
    const params = { then } as unknown as Promise<{ slug: string }>;
    const searchParams = { then } as unknown as Promise<Record<string, never>>;
    const ui = BlogPage({ params, searchParams });
    expect(ui.type).toBe(Suspense);
    expect(then).not.toHaveBeenCalled();
    render(ui.props.fallback);
    expect(
      screen.getByRole('status', { name: 'Loading blog posts' })
    ).toBeInTheDocument();
  });
});
