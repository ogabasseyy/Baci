import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
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
const renderList = () =>
  render(
    <ActivityQueryWrapper>
      <PiggyvestWalletActivity colors={Colors.light} merchantId={MERCHANT} />
    </ActivityQueryWrapper>
  );

describe('PiggyVest wallet activity list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading state, then the movements with ₦ amounts', async () => {
    mockFetch.mockResolvedValue({
      items: [
        activityItem(),
        activityItem({
          id: '00000000-0000-4000-8000-000000000002',
          kind: 'savings_contribution',
          direction: 'out',
          amountKobo: 1000050,
          label: 'Saved to iPhone fund',
          status: 'pending',
        }),
      ],
      nextCursor: null,
    });
    renderList();

    expect(screen.getByText('Loading your activity…')).toBeOnTheScreen();
    expect(await screen.findByText('Money added')).toBeOnTheScreen();
    expect(screen.getByText('+₦50,000')).toBeOnTheScreen();
    expect(screen.getByText('−₦10,000.50')).toBeOnTheScreen();
    expect(screen.getByText(/^Processing · /)).toBeOnTheScreen();
    expect(mockFetch).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      userId: 'customer-1',
      cursor: null,
    });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('says it couldn’t load and retries with Try again', async () => {
    // The hook retries once (about a second) before showing the error.
    mockFetch.mockRejectedValue(new Error('offline'));
    renderList();

    expect(
      await screen.findByText(
        'We couldn’t load your wallet activity.',
        {},
        { timeout: 4000 }
      )
    ).toBeOnTheScreen();
    mockFetch.mockResolvedValue({ items: [activityItem()], nextCursor: null });
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Money added')).toBeOnTheScreen();
  }, 10_000);

  it('shows an empty state when there is no activity', async () => {
    mockFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderList();

    expect(await screen.findByText('No wallet activity yet')).toBeOnTheScreen();
  });

  it('loads the next page with the server cursor', async () => {
    mockFetch.mockResolvedValueOnce({
      items: [activityItem()],
      nextCursor: 'cursor-1',
    });
    mockFetch.mockResolvedValueOnce({
      items: [
        activityItem({
          id: '00000000-0000-4000-8000-000000000003',
          label: 'Returned from Laptop fund',
          kind: 'goal_refund',
        }),
      ],
      nextCursor: null,
    });
    renderList();

    fireEvent.press(await screen.findByRole('button', { name: 'Show more' }));
    expect(
      await screen.findByText('Returned from Laptop fund')
    ).toBeOnTheScreen();
    expect(mockFetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-1' })
    );
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
