import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  merchantContext: vi.fn(),
}));
vi.mock('./imei-remediation-api', () => ({
  imeiRemediationApi: { list: mocks.list },
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mocks.merchantContext,
}));

import { OgabasseyUnlockOrders } from './unlock-orders';

describe('OgabasseyUnlockOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchantContext.mockReturnValue({
      basePath: '/ogabassey',
      merchant: { slug: 'ogabassey' },
    });
    mocks.list.mockResolvedValue([
      {
        amountNgn: 100_000,
        amountUsdt: null,
        carrier: 'AT&T',
        completedAt: null,
        createdAt: '2026-07-11T12:00:00.000Z',
        customerMessage: 'The carrier is processing your request.',
        deviceModel: 'iPhone 17 Pro Max',
        id: 'order-1',
        paymentCurrency: 'NGN',
        refundPolicy: 'refundable',
        status: 'in_progress',
        successRate: 82,
        turnaround: '1-7 Days',
        updatedAt: '2026-07-11T12:03:00.000Z',
      },
    ]);
  });

  it('renders customer-safe carrier unlock tracking details', async () => {
    render(<OgabasseyUnlockOrders />);

    expect(await screen.findByText('iPhone 17 Pro Max')).toBeInTheDocument();
    expect(screen.getByText('AT&T')).toBeInTheDocument();
    expect(screen.getByText(/in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/₦100,000/)).toBeInTheDocument();
    expect(screen.getByText(/in progress/i).className).toContain(
      'text-[var(--store-secondary-text'
    );
    expect(
      screen.getByText('The carrier is processing your request.').className
    ).toContain('text-[var(--store-secondary-text');
    expect(screen.queryByText(/provider order/i)).toBeNull();
    expect(mocks.list).toHaveBeenCalledWith('ogabassey');
    expect(screen.getByRole('link', { name: /new check/i })).toHaveAttribute(
      'href',
      '/ogabassey/imei-check'
    );
  });

  it('keeps the new-check link root-relative on domain storefronts', async () => {
    mocks.merchantContext.mockReturnValue({
      merchant: { slug: 'ogabassey' },
    });

    render(<OgabasseyUnlockOrders />);

    await screen.findByText('iPhone 17 Pro Max');
    expect(screen.getByRole('link', { name: /new check/i })).toHaveAttribute(
      'href',
      '/imei-check'
    );
  });

  it('uses storefront background text tokens for empty-state contrast', async () => {
    mocks.list.mockResolvedValue([]);
    render(<OgabasseyUnlockOrders />);

    const heading = await screen.findByRole('heading', {
      name: 'No unlock orders yet',
    });
    expect(heading.className).toContain('text-[var(--ogabassey-surface-text');
    expect(screen.getByText(/eligible clean carrier-unlock options/i).className).toContain(
      'text-store-background-text/70'
    );
  });
});
