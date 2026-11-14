import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  ActivityQueryWrapper,
  activityItem,
} from './activity-test-harness.test-support';
import { PiggyvestWalletActivity } from './PiggyvestWalletActivity';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-wallet-activity', () => ({
  fetchPiggyvestWalletActivity: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { user: { id: string } }) => unknown) =>
    select({ user: { id: 'customer-1' } }),
}));

const MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const firstPage = {
  items: [
    activityItem({
      id: '00000000-0000-4000-8000-0000000000a1',
      label: 'Page one row',
    }),
  ],
  nextCursor: 'cursor-page-2',
};
const secondPage = {
  items: [
    activityItem({
      id: '00000000-0000-4000-8000-0000000000b1',
      label: 'Page two row',
    }),
  ],
  nextCursor: null,
};
const list = (refreshKey: number) => (
  <PiggyvestWalletActivity
    colors={Colors.light}
    merchantId={MERCHANT}
    refreshKey={refreshKey}
  />
);
const cursors = () =>
  mockFetch.mock.calls.map((call) => (call[0] as { cursor: unknown }).cursor);

describe('bugfix: "Show more" re-read page 1 without the cursor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('asks for page 2 with the cursor and appends its distinct rows', async () => {
    mockFetch
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    render(list(1), { wrapper: ActivityQueryWrapper });

    fireEvent.press(await screen.findByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Page two row')).toBeOnTheScreen();
    expect(screen.getByText('Page one row')).toBeOnTheScreen();
    expect(cursors()).toEqual([null, 'cursor-page-2']);
  });

  it('a wallet refresh during "Show more" neither cancels it nor drops the cursor', async () => {
    let finishPageTwo!: (page: typeof secondPage) => void;
    let pageTwoCalls = 0;
    mockFetch.mockImplementation((input) => {
      const { cursor } = input as { cursor: string | null };
      if (!cursor) return Promise.resolve(firstPage);
      pageTwoCalls += 1;
      if (pageTwoCalls === 1)
        return new Promise((resolve) => {
          finishPageTwo = resolve;
        });
      return Promise.resolve(secondPage);
    });
    const view = render(list(1), { wrapper: ActivityQueryWrapper });
    fireEvent.press(await screen.findByRole('button', { name: 'Show more' }));

    // The wallet refreshes (its updated time changes) while page 2 loads:
    // nothing new is requested until page 2 has arrived.
    view.rerender(list(2));
    expect(cursors()).toEqual([null, 'cursor-page-2']);
    await act(async () => {
      finishPageTwo(secondPage);
    });

    expect(await screen.findByText('Page two row')).toBeOnTheScreen();
    expect(screen.getByText('Page one row')).toBeOnTheScreen();
    // Only then the deferred refresh re-reads both pages, each with its own
    // cursor; page 2 is never asked for without one.
    expect(cursors().slice(0, 2)).toEqual([null, 'cursor-page-2']);
    expect(pageTwoCalls).toBeGreaterThanOrEqual(1);
  });

  it('keeps the rows and offers Try again when "Show more" fails', async () => {
    let offline = true;
    mockFetch.mockImplementation((input) => {
      const { cursor } = input as { cursor: string | null };
      if (!cursor) return Promise.resolve(firstPage);
      return offline
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(secondPage);
    });
    render(list(1), { wrapper: ActivityQueryWrapper });

    fireEvent.press(await screen.findByRole('button', { name: 'Show more' }));

    // One automatic retry (about a second) runs before the message shows.
    expect(
      await screen.findByText(
        'We couldn’t load more activity.',
        {},
        { timeout: 4000 }
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('Page one row')).toBeOnTheScreen();
    offline = false;
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Page two row')).toBeOnTheScreen();
    expect(cursors().filter((cursor) => cursor === null)).toHaveLength(1);
  }, 10_000);
});
