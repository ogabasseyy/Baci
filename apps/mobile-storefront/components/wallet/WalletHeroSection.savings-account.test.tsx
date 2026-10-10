import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { WalletContent } from './WalletContent';
import { WalletHeroSection } from './WalletHeroSection';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'savings-synthetic' },
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 'user-1' }, merchantId: 'merchant-1' }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useNavigation: () => ({ addListener: () => () => undefined }),
}));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ products: [], isLoading: false }),
}));

const props = {
  earningsBalance: 0,
  loyaltyPoints: 0,
  onOpenFundPanel: jest.fn(),
  onOpenRedeemPanel: jest.fn(),
  savingsBalance: 100,
  totalBalance: 100,
  activeSavingsGoal: {
    id: 'goal-1',
    source_mode: 'manual' as const,
    status: 'active' as const,
  },
};
const originalEnv = { ...process.env };
const environmentKeys = [
  'EXPO_PUBLIC_HOSTED_STOREFRONT',
  'EXPO_PUBLIC_STAGING_TEST_PAYMENTS',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
] as const;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
  process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS = '1';
  process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
  jest.mocked(fetchExistingSavingsPlanFunding).mockResolvedValue({
    status: 'ready',
    accounts: [
      {
        accountName: 'Test savings',
        accountNumber: '0000008907',
        bankName: 'FAAS (SANDBOX)',
      },
    ],
  });
});
afterEach(() => {
  for (const key of environmentKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

it('replaces Create account with the existing PiggyVest savings number when the wallet has no Paystack account', async () => {
  render(<WalletHeroSection {...props} fundingAccount={null} />);
  await act(async () => {});

  expect(screen.getByText('0000008907')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Create account number' })
  ).toBeNull();
  expect(screen.getByText('FAAS (SANDBOX)')).toBeOnTheScreen();
  expect(screen.queryByText('SAVINGS · TEST')).toBeNull();
  expect(screen.queryByText('Test savings')).toBeNull();
  expect(fetchExistingSavingsPlanFunding).toHaveBeenCalledWith({
    goalId: 'goal-1',
    merchantId: 'merchant-1',
    merchantSlug: 'savings-synthetic',
  });
});

it('connects the actual wallet content to the savings account slot without changing its Add Money action', async () => {
  const contentProps = createWalletContentProps();
  render(<WalletContent {...contentProps} fundingAccount={null} />);
  await act(async () => {});

  expect(screen.getByText('0000008907')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Create account number' })
  ).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Add money' }));
  expect(contentProps.onOpenFundPanel).toHaveBeenCalledTimes(1);
});

it('leaves the production account slot unchanged and never looks up a sandbox account', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://ogabassey.com';
  render(<WalletHeroSection {...props} fundingAccount={null} />);

  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toBeOnTheScreen();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it('does not replace a real wallet top-up account with a goal-specific savings account', () => {
  render(
    <WalletHeroSection
      {...props}
      fundingAccount={{
        accountName: 'Wallet',
        accountNumber: '1234567890',
        bankName: 'Wallet bank',
        provider: 'paystack',
      }}
    />
  );

  expect(screen.getByText('1234567890')).toBeOnTheScreen();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it.each([
  'paused',
  'completed',
] as const)('does not show the savings account for a %s plan', (status) => {
  render(
    <WalletHeroSection
      {...props}
      activeSavingsGoal={{ ...props.activeSavingsGoal, status }}
    />
  );

  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toBeOnTheScreen();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it('does not show a savings account for the unsupported auto-debit flow', () => {
  render(
    <WalletHeroSection
      {...props}
      activeSavingsGoal={{
        ...props.activeSavingsGoal,
        source_mode: 'auto_debit',
      }}
    />
  );

  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it('refreshes the displayed savings account after a wallet pull-to-refresh', async () => {
  const view = render(<WalletHeroSection {...props} isRefetching={false} />);
  await act(async () => {});
  expect(screen.getByText('0000008907')).toBeOnTheScreen();
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockResolvedValue({ status: 'pending', code: 'MAPPING_PENDING' });

  view.rerender(<WalletHeroSection {...props} isRefetching />);
  await act(async () => {
    view.rerender(<WalletHeroSection {...props} isRefetching={false} />);
  });

  await waitFor(() => expect(screen.queryByText('0000008907')).toBeNull());
  expect(screen.getByText('Savings account not ready')).toBeOnTheScreen();
});
