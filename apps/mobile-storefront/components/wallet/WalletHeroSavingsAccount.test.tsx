import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  fetchExistingSavingsPlanFunding,
  fetchSavingsPlanFunding,
} from '@/lib/customer-savings';
import type { SavingsPlanFundingResponse } from '@/schemas/customer-savings';
import { WalletHeroSavingsAccount } from './WalletHeroSavingsAccount';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'savings-synthetic' },
}));
let mockUserId: string | undefined = 'user-1';
let mockMerchantId = 'merchant-1';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: mockUserId ? { id: mockUserId } : null,
      merchantId: mockMerchantId,
    }),
}));
let mockFocusListener: () => void = () => undefined;
const mockNavigation = {
  addListener: jest.fn((_event: string, listener: () => void) => {
    mockFocusListener = listener;
    return () => undefined;
  }),
};
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));

const accountResponse: SavingsPlanFundingResponse = {
  status: 'ready',
  accounts: [
    {
      accountName: 'Test savings',
      accountNumber: '0000008907',
      bankName: 'FAAS (SANDBOX)',
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'user-1';
  mockMerchantId = 'merchant-1';
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockResolvedValue(accountResponse);
});

it('displays only the retrieved account and never provisions on wallet open', async () => {
  render(<WalletHeroSavingsAccount goalId="goal-1" isRefetching={false} />);
  await act(async () => {});

  expect(screen.getByText('0000008907')).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Copy savings account number' })
  ).toBeOnTheScreen();
  expect(fetchSavingsPlanFunding).not.toHaveBeenCalled();
});

it('allows retry after lookup failure without creating a second account', async () => {
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockRejectedValueOnce(new Error('Unavailable'));
  render(<WalletHeroSavingsAccount goalId="goal-1" isRefetching={false} />);
  await act(async () => {});
  expect(screen.getByText('Unable to load savings account')).toBeOnTheScreen();

  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Retry savings account lookup' })
    );
  });

  expect(screen.getByText('0000008907')).toBeOnTheScreen();
  expect(fetchSavingsPlanFunding).not.toHaveBeenCalled();
});

it('refreshes after returning from account setup', async () => {
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockResolvedValueOnce({ status: 'pending', code: 'MAPPING_PENDING' });
  render(<WalletHeroSavingsAccount goalId="goal-1" isRefetching={false} />);
  await act(async () => {});
  expect(screen.getByText('Savings account not ready')).toBeOnTheScreen();

  await act(async () => {
    mockFocusListener();
  });

  expect(screen.getByText('0000008907')).toBeOnTheScreen();
});

it('removes the previous account immediately on sign out', async () => {
  const view = render(
    <WalletHeroSavingsAccount goalId="goal-1" isRefetching={false} />
  );
  await act(async () => {});
  expect(screen.getByText('0000008907')).toBeOnTheScreen();

  mockUserId = undefined;
  view.rerender(
    <WalletHeroSavingsAccount goalId="goal-1" isRefetching={false} />
  );

  expect(screen.queryByText('0000008907')).toBeNull();
  expect(screen.getByText('Sign in to view savings account')).toBeOnTheScreen();
});

it.each([
  'user',
  'merchant',
  'goal',
] as const)('discards an in-flight account response after the %s changes', async (scope) => {
  let resolvePrevious: (value: SavingsPlanFundingResponse) => void = () =>
    undefined;
  jest.mocked(fetchExistingSavingsPlanFunding).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePrevious = resolve;
      })
  );
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockResolvedValue({ status: 'pending', code: 'MAPPING_PENDING' });
  const view = render(
    <WalletHeroSavingsAccount goalId="goal-1" isRefetching={false} />
  );

  if (scope === 'user') mockUserId = 'user-2';
  if (scope === 'merchant') mockMerchantId = 'merchant-2';
  await act(async () => {
    view.rerender(
      <WalletHeroSavingsAccount
        goalId={scope === 'goal' ? 'goal-2' : 'goal-1'}
        isRefetching={false}
      />
    );
  });
  await act(async () => {
    resolvePrevious(accountResponse);
  });

  expect(screen.queryByText('0000008907')).toBeNull();
  expect(screen.getByText('Savings account not ready')).toBeOnTheScreen();
});
