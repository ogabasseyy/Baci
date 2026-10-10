import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { WalletContent } from './WalletContent';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');

  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
  };
});

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));

jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ isLoading: false, products: [] }),
}));

jest.mock('expo-image', () => ({ Image: () => null }));

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));

let mockStagingFundingEnabled = false;
let mockUserId: string | undefined;

jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => mockStagingFundingEnabled,
  isHostedStagingWalletTopUpBlocked: () => false,
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'savings-synthetic' },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: mockUserId ? { id: mockUserId } : null,
      merchantId: 'merchant-1',
    }),
}));

const props = createWalletContentProps();

beforeEach(() => {
  jest.clearAllMocks();
  mockStagingFundingEnabled = true;
  mockUserId = 'user-1';
  jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue({
    status: 'ready',
    accounts: [
      {
        accountName: 'Plan account',
        accountNumber: '0000008907',
        bankName: 'FAAS (SANDBOX)',
      },
    ],
  });
});

it('refreshes wallet goal data when the bank transfer account is refreshed', async () => {
  const refreshWallet = jest.fn(async () => ({ isError: false }));
  render(
    <WalletContent
      {...props}
      onRefresh={refreshWallet}
      showSavingsProgress={true}
    />
  );
  await act(async () => {});

  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings account' })
    );
    await Promise.resolve();
  });

  expect(fetchExistingSavingsPlanFunding).toHaveBeenCalledTimes(2);
  expect(refreshWallet).toHaveBeenCalledTimes(1);
});

it('does not leak a late refresh failure or busy state after the customer changes', async () => {
  let rejectRefresh: (error: Error) => void = () => undefined;
  const refreshWallet = jest.fn(
    () =>
      new Promise<unknown>((_resolve, reject) => {
        rejectRefresh = reject;
      })
  );
  const view = render(
    <WalletContent
      {...props}
      onRefresh={refreshWallet}
      showSavingsProgress={true}
    />
  );
  await act(async () => {});

  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh savings account' })
  );
  expect(
    screen.getByRole('button', { name: 'Refresh savings account' })
  ).toBeDisabled();

  mockUserId = 'user-2';
  view.rerender(
    <WalletContent
      {...props}
      onRefresh={refreshWallet}
      showSavingsProgress={true}
    />
  );
  await act(async () => {});

  await act(async () => {
    rejectRefresh(new Error('Previous customer refresh failed'));
    await Promise.resolve();
  });

  expect(screen.queryByText('Previous customer refresh failed')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Refresh savings account' })
  ).not.toBeDisabled();
  expect(screen.getByText('Refresh account')).toBeOnTheScreen();
});
