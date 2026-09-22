import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRecentInteractions: vi.fn(),
  getSantaStats: vi.fn(),
  useMerchant: vi.fn(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: mocks.useMerchant,
}));
vi.mock('@/components/ui/bag-loader', () => ({
  BagLoader: () => <div>Loading...</div>,
}));
vi.mock('./actions', () => ({
  getRecentInteractions: mocks.getRecentInteractions,
  getSantaStats: mocks.getSantaStats,
}));

import SantaClientPage from './client-page';

describe('SantaClientPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useMerchant.mockReturnValue({
      loading: false,
      merchant: {
        country: 'GH',
        id: 'merchant-1',
        payout_currency: 'GHS',
      },
    });
    mocks.getSantaStats.mockResolvedValue({
      avg_discount: 10,
      total_chats: 2,
      total_revenue: 1000,
      unique_sessions: 1,
      wishes_denied: 0,
      wishes_granted: 1,
    });
    mocks.getRecentInteractions.mockResolvedValue([]);
  });

  it('formats analytics amounts using the resolved merchant currency', async () => {
    render(<SantaClientPage />);

    await waitFor(() => {
      expect(screen.getByText(/GH/)).toBeInTheDocument();
    });
  });
});
