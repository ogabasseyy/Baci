import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

import { AccessManagementClient } from './access-management-client';

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

const globals = globalThis as unknown as {
  ResizeObserver?: typeof ResizeObserverStub;
};
globals.ResizeObserver ??= ResizeObserverStub;

describe('AccessManagementClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the access management empty state after a successful live load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          data: [],
          generatedAt: '2026-08-05T10:00:00.000Z',
        }),
        ok: true,
      })
    );

    render(<AccessManagementClient />);

    expect(
      screen.getByRole('heading', { name: 'Access management' })
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(/No managed platform members yet/i)
      ).toBeInTheDocument();
    });
  });
});
