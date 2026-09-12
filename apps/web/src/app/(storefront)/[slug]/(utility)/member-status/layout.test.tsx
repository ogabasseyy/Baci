import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const customerAuthLayoutMock = vi.fn(
  ({ children }: { children: ReactNode; params: { slug: string } }) => (
    <div data-testid="customer-auth-layout">{children}</div>
  )
);

vi.mock('@/app/(storefront)/[slug]/customer-auth-layout', () => ({
  default: (props: { children: ReactNode; params: { slug: string } }) =>
    customerAuthLayoutMock(props),
}));

import MemberStatusLayout from './layout';

describe('MemberStatusLayout', () => {
  it('eagerly styles member status and wraps it in customer auth', async () => {
    const node = await MemberStatusLayout({
      children: <div>Member status</div>,
      params: Promise.resolve({ slug: 'OgaBassey' }),
    });

    render(node);

    expect(screen.getByTestId('customer-auth-layout')).toBeInTheDocument();
    expect(screen.getByText('Member status')).toBeInTheDocument();
  });
});
