import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const customerAuthLayoutMock = vi.fn(
  ({ children }: { children: ReactNode; params: { slug: string } }) => (
    <section aria-label="Customer account layout">{children}</section>
  )
);

vi.mock('@/app/(storefront)/[slug]/customer-auth-layout', () => ({
  default: (props: { children: ReactNode; params: { slug: string } }) =>
    customerAuthLayoutMock(props),
}));

import AccountLayout, { metadata } from './layout';

describe('AccountLayout', () => {
  it('marks account routes noindex while preserving follow for internal links', () => {
    expect(metadata.robots).toMatchObject({ follow: true, index: false });
  });

  it('wraps account routes in CustomerAuthLayout with the resolved slug', async () => {
    const node = await AccountLayout({
      children: <div>Account content</div>,
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    render(node);

    expect(
      screen.getByRole('region', { name: /customer account layout/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Account content')).toBeInTheDocument();
    expect(customerAuthLayoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { slug: 'ogabassey' },
      })
    );
  });
});
