import { act, render, screen } from '@testing-library/react-native';
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
  useFocusEffect: jest.fn(),
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

it('never fetches or shows a savings goal account number when the wallet has no bank account', async () => {
  render(<WalletHeroSection {...props} fundingAccount={null} />);
  await act(async () => {});

  expect(screen.queryByText('0000008907')).toBeNull();
  expect(screen.queryByText('FAAS (SANDBOX)')).toBeNull();
  expect(screen.queryByText('SAVINGS · TEST')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Copy savings account number' })
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Create account number' })
  ).toBeOnTheScreen();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it('keeps goal account numbers out of the actual wallet content', async () => {
  render(
    <WalletContent {...createWalletContentProps()} fundingAccount={null} />
  );
  await act(async () => {});

  expect(screen.queryByText('0000008907')).toBeNull();
  expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
});

it('still shows the real wallet top-up account', () => {
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
