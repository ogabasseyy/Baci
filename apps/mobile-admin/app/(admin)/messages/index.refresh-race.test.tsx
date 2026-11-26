import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
vi.mock('@/components/ui/KeyboardInsetView', () => ({
  KeyboardInsetView: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: LIGHT_COLORS }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'm1' } }),
}));
vi.mock('@/lib/merchant-inbox-api', () => ({
  fetchInboxConversations: mocks.fetch,
}));
vi.mock('@/hooks/useInboxSearch', () => ({
  useInboxSearch: () => ({ results: [] }),
}));
vi.mock('@/components/ui/AppHeaderKeyboardContainer', () => ({
  AppHeaderKeyboardContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/lib/api-client', async () => {
  const errors = await import('@/lib/api-errors');
  return { NetworkError: errors.NetworkError };
});
vi.mock('@shopify/flash-list', async () => ({
  FlashList: (await import('@/test/messages-screen-support')).FlashListMock,
}));

import { conversation } from '@/test/messages-screen-support';
import MessagesScreen from './index';

/** Only the first page has a chat, and the server always has more behind. */
const answer = (page: number, name = 'Ada Test') => ({
  conversations: page === 1 ? [conversation(1, name, 'customer')] : [],
  hasMore: true,
  page,
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

/** The real list query, loaded as far as the screen goes by itself. */
async function renderLoaded() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.fetch.mockImplementation(async (page: number) => answer(page));
  render(
    <QueryClientProvider client={client}>
      <MessagesScreen />
    </QueryClientProvider>
  );
  await settle();
  expect(mocks.fetch).toHaveBeenCalledTimes(5);
  return client;
}

/** Holds the next request open; call the result to answer it with page 1. */
function holdNextRequest() {
  let finish: () => void = () => {};
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(answer(1, 'Fresh Test'));
      })
  );
  return () => finish();
}

/**
 * Starts a refresh and taps before the screen has heard of it, so the button
 * still believes nothing is being fetched.
 */
async function tapAsRefreshStarts(client: QueryClient, name: string) {
  const button = screen.getByRole('button', { name });
  act(() => {
    client.refetchQueries();
    fireEvent.click(button);
  });
  await settle();
}

const requestedPages = () => mocks.fetch.mock.calls.map(([page]) => page);

/** The held refresh was left alone: nothing but it was requested. */
async function expectRefreshToFinish(finish: () => void, before: number) {
  expect(requestedPages().slice(before)).toEqual([1]);
  await act(async () => finish());
  await settle();
  expect(screen.getByText('Fresh Test')).toBeInTheDocument();
}

describe('MessagesScreen taps landing as a refresh starts', () => {
  beforeEach(() => vi.resetAllMocks());

  it('bugfix: looking further back does not cancel the refresh', async () => {
    const client = await renderLoaded();
    const finish = holdNextRequest();

    await tapAsRefreshStarts(client, 'Look further back');

    await expectRefreshToFinish(finish, 5);
  });

  it('bugfix: scrolling to the end does not cancel the refresh', async () => {
    const client = await renderLoaded();
    const finish = holdNextRequest();
    fireEvent.click(
      screen.getByRole('button', { name: 'List dragged (test)' })
    );

    await tapAsRefreshStarts(client, 'List end reached (test)');

    await expectRefreshToFinish(finish, 5);
  });

  it('bugfix: retrying a failed update does not restart a running refresh', async () => {
    const client = await renderLoaded();
    mocks.fetch.mockRejectedValueOnce(new Error('down'));
    await act(async () => {
      await client.refetchQueries();
    });
    await settle();
    const before = mocks.fetch.mock.calls.length;
    const finish = holdNextRequest();

    await tapAsRefreshStarts(client, 'Could not update chats. Tap to retry.');

    await expectRefreshToFinish(finish, before);
  });
});
