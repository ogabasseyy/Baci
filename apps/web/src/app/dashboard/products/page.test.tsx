import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMerchantForUser: vi.fn(),
  getProducts: vi.fn(),
  permissionGrantsAccess: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirect');
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/merchant-server', () => ({
  getMerchantForUser: mocks.getMerchantForUser,
}));
vi.mock('@/lib/products-server', () => ({ getProducts: mocks.getProducts }));
vi.mock('@/lib/permission-grant', () => ({
  permissionGrantsAccess: mocks.permissionGrantsAccess,
}));
vi.mock('./client-page', () => ({ default: () => <div>product list</div> }));

import ProductsPage from './page';

const renderPage = async () =>
  render(await ProductsPage({ searchParams: Promise.resolve({}) }));

describe('Ogabassey discovery link on products page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProducts.mockResolvedValue({ products: [] });
    mocks.getMerchantForUser.mockResolvedValue({
      merchant: { id: 'merchant-1', slug: 'ogabassey' },
      user: { id: 'user-1' },
      staffAccess: { isOwner: false, permissions: {} },
    });
    mocks.permissionGrantsAccess.mockReturnValue(false);
  });

  it('shows the indexing link to an Ogabassey product editor', async () => {
    mocks.permissionGrantsAccess.mockReturnValue(true);
    await renderPage();
    expect(mocks.permissionGrantsAccess).toHaveBeenCalledWith(
      {},
      'products',
      'edit'
    );
    expect(
      screen.getByRole('link', {
        name: /Manage ChatGPT product search indexing/,
      })
    ).toHaveAttribute('href', '/dashboard/products/discovery');
  });

  it('hides the link from a staff member without edit permission and from other merchants', async () => {
    await renderPage();
    expect(
      screen.queryByRole('link', {
        name: /Manage ChatGPT product search indexing/,
      })
    ).not.toBeInTheDocument();
    mocks.getMerchantForUser.mockResolvedValue({
      merchant: { id: 'merchant-2', slug: 'other' },
      user: { id: 'user-1' },
      staffAccess: { isOwner: true, permissions: {} },
    });
    await renderPage();
    expect(
      screen.queryByRole('link', {
        name: /Manage ChatGPT product search indexing/,
      })
    ).not.toBeInTheDocument();
  });
});
