import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();
const mockGetAdminMerchant360 = vi.fn();
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/admin-merchant-360', () => ({
  getAdminMerchant360: (...args: unknown[]) => mockGetAdminMerchant360(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import Merchant360Page from '@/app/admin/merchants/[merchantId]/page';

describe('Merchant360Page error panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({ rpc: vi.fn() });
  });

  it('renders a friendly error panel when the bounded RPC fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetAdminMerchant360.mockResolvedValue({
      data: null,
      error: { code: '500', message: 'database unavailable' },
    });

    render(
      await Merchant360Page({
        params: Promise.resolve({ merchantId: MERCHANT_ID }),
      })
    );

    expect(errorSpy).toHaveBeenCalledWith(
      '[Admin] Failed to load merchant operations snapshot:',
      { code: '500', merchantId: MERCHANT_ID }
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Merchant operations could not load'
    );
    expect(
      screen.getByRole('link', { name: /back to merchants/i })
    ).toHaveAttribute('href', '/admin/merchants');

    errorSpy.mockRestore();
  });
});
