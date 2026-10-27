import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  client: vi.fn(),
  load: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));
vi.mock('@/lib/merchant-server', () => ({ getMerchantForUser: mocks.lookup }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/chatgpt-ads/load-connection', () => ({
  loadChatgptAdsConnection: mocks.load,
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./client-page', () => ({
  default: (props: unknown) => (
    <pre data-testid="connection">{JSON.stringify(props)}</pre>
  ),
}));

import Page from './page';

const connection = { pixelId: 'pixel', capiConfigured: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue({
    user: { id: 'user' },
    merchant: { id: 'owned' },
    staffAccess: { isOwner: true },
  });
  mocks.client.mockResolvedValue({ callerBound: true });
  mocks.load.mockResolvedValue(connection);
});
it('loads initial public connection state on the server for the resolved owner', async () => {
  render(await Page());
  expect(mocks.load).toHaveBeenCalledWith({ callerBound: true }, 'owned');
  expect(screen.getByTestId('connection')).toHaveTextContent(
    JSON.stringify({
      initialMerchantId: 'owned',
      initialConnection: connection,
    })
  );
});
it('redirects unauthenticated visitors before loading merchant settings', async () => {
  mocks.lookup.mockResolvedValue({
    user: null,
    merchant: null,
    staffAccess: { isOwner: false },
  });
  await expect(Page()).rejects.toThrow('REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledWith('/login');
  expect(mocks.load).not.toHaveBeenCalled();
});
it.each([
  null,
  { id: 'staff-store' },
])('does not read settings without merchant owner access', async (merchant) => {
  mocks.lookup.mockResolvedValue({
    user: { id: 'user' },
    merchant,
    staffAccess: { isOwner: false },
  });
  render(await Page());
  expect(screen.getByRole('alert')).toHaveTextContent('Only the store owner');
  expect(mocks.client).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});
it('renders a safe server load error without leaking database details', async () => {
  mocks.load.mockRejectedValue(new Error('private database detail'));
  render(await Page());
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load');
  expect(screen.queryByText(/private database detail/)).not.toBeInTheDocument();
});
