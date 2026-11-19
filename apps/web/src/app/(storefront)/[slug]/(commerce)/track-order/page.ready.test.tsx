import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TrackOrderPage from './page';

const mocks = vi.hoisted(() => ({
  state: { searchParams: new URLSearchParams(), isReady: true },
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-private-search-params', () => ({
  usePrivateSearchParamsState: () => mocks.state,
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'shop' }),
}));
vi.mock('@/hooks/merchant', () => ({
  useMerchant: () => ({ merchant: { slug: 'shop' } }),
}));

describe('bugfix: reloaded track-order link ran its lookup effect before the stash was readable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetch.mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('sends no lookup while not ready, then looks the order up once with the token', async () => {
    mocks.state = { searchParams: new URLSearchParams(), isReady: false };
    const { rerender } = render(<TrackOrderPage />);
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.state = {
      searchParams: new URLSearchParams({ token: 'tok-1' }),
      isReady: true,
    };
    rerender(<TrackOrderPage />);

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(mocks.fetch.mock.calls[0])).toContain('tok-1');
  });
});
