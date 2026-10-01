import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
const mockFetchWithCsrf = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

import SystemHealthPage from './page';

describe('SystemHealthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          checkedAt: '2026-03-20T10:00:00.000Z',
          health: [],
          indexRecommendations: [],
          missingIndexes: [],
        }),
        ok: true,
      }) as unknown as typeof fetch
    );
    mockFetchWithCsrf.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses a CSRF-aware request and accurately labels the analytics cache reload', async () => {
    const user = userEvent.setup();
    render(<SystemHealthPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/db-health', {
        signal: expect.any(AbortSignal),
      });
    });

    await user.click(screen.getByRole('button', { name: 'Reload Analytics' }));

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/admin/analytics', {
        method: 'POST',
      });
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Success',
        description: 'Live analytics cache has been reloaded.',
      });
    });

    expect(
      screen.queryByText('Refresh Analytics Views')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('View Backups')).not.toBeInTheDocument();
  });

  it('shows a persistent error instead of a zero health score when checks fail', async () => {
    const user = userEvent.setup();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          checkedAt: '2026-03-20T10:00:00.000Z',
          health: [],
          indexRecommendations: [],
          missingIndexes: [],
        }),
        ok: true,
      } as Response);

    render(<SystemHealthPage />);

    expect(
      await screen.findByText('System health unavailable')
    ).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Overall Health Score')).toBeInTheDocument();
  });
});
