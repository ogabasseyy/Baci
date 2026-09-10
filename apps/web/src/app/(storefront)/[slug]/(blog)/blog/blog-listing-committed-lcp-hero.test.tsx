import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./blog-listing-ogabassey-lcp-hero', () => ({
  BlogListingOgabasseyLcpHero: () => <article>Root featured story</article>,
}));

const { BlogListingCommittedLcpHero } = await import(
  './blog-listing-committed-lcp-hero'
);

describe('BlogListingCommittedLcpHero', () => {
  it('paints the snapshot hero for static Ogabassey tenants', async () => {
    render(
      await BlogListingCommittedLcpHero({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(screen.getByText('Root featured story')).toBeInTheDocument();
    expect(document.querySelector('[data-blog-lcp-hero]')).not.toBeNull();
  });

  it('does not leak the Ogabassey snapshot onto other merchants', async () => {
    render(
      await BlogListingCommittedLcpHero({
        params: Promise.resolve({ slug: 'another-ogabassey-template-store' }),
      })
    );

    expect(screen.queryByText('Root featured story')).not.toBeInTheDocument();
  });
});
