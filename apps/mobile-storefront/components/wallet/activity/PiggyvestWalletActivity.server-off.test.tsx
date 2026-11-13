import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { ActivityQueryWrapper } from './activity-test-harness.test-support';
import { PiggyvestWalletActivity } from './PiggyvestWalletActivity';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-wallet-activity', () => ({
  fetchPiggyvestWalletActivity: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { user: { id: string } }) => unknown) =>
    select({ user: { id: 'customer-1' } }),
}));

describe('PiggyVest wallet activity with the server keeping PiggyVest off', () => {
  it('answers a 503 with the calm couldn’t-load state, never a crash', async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error('off'), { code: 'PIGGYVEST_NOT_READY' })
    );
    render(
      <ActivityQueryWrapper>
        <PiggyvestWalletActivity
          colors={Colors.light}
          merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
        />
      </ActivityQueryWrapper>
    );

    expect(
      await screen.findByText(
        'We couldn’t load your wallet activity.',
        {},
        { timeout: 4000 }
      )
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  }, 10_000);
});
