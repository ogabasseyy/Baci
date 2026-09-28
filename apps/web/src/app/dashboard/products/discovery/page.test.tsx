import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensurePermission: vi.fn(),
  isPermissionRedirect: vi.fn(),
}));
vi.mock('@/lib/merchant-server', () => ({
  ensurePermission: mocks.ensurePermission,
  isMerchantPermissionRedirectError: mocks.isPermissionRedirect,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  redirect: () => {
    throw new Error('permission-redirect');
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('./discovery-backfill-panel', () => ({
  DiscoveryBackfillPanel: ({ merchantId }: { merchantId: string }) => (
    <div>panel:{merchantId}</div>
  ),
}));

import DiscoveryBackfillPage from './page';

describe('Ogabassey discovery dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPermissionRedirect.mockReturnValue(false);
  });

  it('renders only for a product editor at Ogabassey', async () => {
    mocks.ensurePermission.mockResolvedValue({
      merchant: { id: 'merchant-1', slug: 'ogabassey' },
    });
    render(await DiscoveryBackfillPage());
    expect(mocks.ensurePermission).toHaveBeenCalledWith('products', 'edit');
    expect(screen.getByText('panel:merchant-1')).toBeInTheDocument();
  });

  it('rejects other merchants and permission redirects', async () => {
    mocks.ensurePermission.mockResolvedValueOnce({
      merchant: { id: 'other', slug: 'other' },
    });
    await expect(DiscoveryBackfillPage()).rejects.toThrow('not-found');
    mocks.ensurePermission.mockRejectedValueOnce(new Error('denied'));
    mocks.isPermissionRedirect.mockReturnValueOnce(true);
    await expect(DiscoveryBackfillPage()).rejects.toThrow(
      'permission-redirect'
    );
  });
});
