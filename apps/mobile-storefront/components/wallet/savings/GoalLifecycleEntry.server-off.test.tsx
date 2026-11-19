import { act, render, screen, waitFor } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import {
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { GoalLifecycleEntry } from './GoalLifecycleEntry';

jest.mock('@/lib/piggyvest-primary-wallet');
jest.mock('@/lib/is-piggyvest-primary-merchant');

const goal = {
  id: 'g',
  title: 'G',
  status: 'completed',
  current_amount: 9,
  target_amount: 5,
  maturity_date: '2000-01-01',
} as WalletActiveSavingsGoal;
const read = jest.mocked(piggyvestPrimaryWalletApi.read);

function renderEntry() {
  render(
    <GoalLifecycleEntry
      colors={Colors.light}
      goal={goal}
      hasPendingContribution={false}
      onCancel={jest.fn()}
      onComplete={jest.fn()}
    />
  );
}
function expectNoLifecycleButtons() {
  expect(screen.queryByText('Cancel goal')).toBeNull();
  expect(screen.queryByText('Complete goal')).toBeNull();
}

describe('server keeps PiggyVest off', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(true);
    act(() => {
      useAuthStore.setState({
        user: { id: 'u' } as never,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
  });

  it.each([
    ['PIGGYVEST_NOT_READY', () => read.mockRejectedValue(serverOffError())],
    [
      'a pending snapshot',
      () =>
        read.mockResolvedValue({
          account: null,
          requiresConsent: true,
          provisioningStatus: 'pending',
        }),
    ],
    ['a failed read', () => read.mockRejectedValue(new Error('offline'))],
  ])('shows nothing for %s', async (_name, arrange) => {
    arrange();
    renderEntry();
    await waitFor(() => expect(read).toHaveBeenCalled());
    expectNoLifecycleButtons();
  });

  it('shows nothing and reads nothing for a merchant outside the pilot', () => {
    jest.mocked(isPiggyvestPrimaryMerchant).mockReturnValue(false);
    renderEntry();
    expectNoLifecycleButtons();
    expect(read).not.toHaveBeenCalled();
  });
});
