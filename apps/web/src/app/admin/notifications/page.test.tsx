import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/api-client', () => ({ apiDelete: vi.fn() }));

import AdminNotificationsPage from './page';

describe('AdminNotificationsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          dashboard: {
            activeBanners: 2,
            avgReadRate: 62.5,
            deliveryExpired: 5,
            deliveryFailed: 6,
            deliveryPending: 7,
            deliveryProcessing: 8,
            scheduled: 4,
            totalSent: 37,
          },
          data: [],
          pagination: { total: 120 },
        }),
        ok: true,
      }) as unknown as typeof fetch
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses server aggregate totals instead of the current paginated notification rows', async () => {
    render(<AdminNotificationsPage />);

    await waitFor(() => {
      expect(screen.getByText('37')).toBeInTheDocument();
      expect(screen.getByText('63%')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('6')).toBeInTheDocument();
      expect(screen.getByText('7')).toBeInTheDocument();
      expect(screen.getByText('8')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Expired')).toBeInTheDocument();
    });
  });

  it('shows a retryable error instead of an empty-state claim when loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<AdminNotificationsPage />);

    expect(
      await screen.findByText('Notifications could not load.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeEnabled();
    expect(
      screen.queryByText('No notifications found')
    ).not.toBeInTheDocument();
  });
});
