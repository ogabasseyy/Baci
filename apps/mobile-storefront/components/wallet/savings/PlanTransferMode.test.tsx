import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from 'react-native';
import Colors from '@/constants/Colors';
import { StartSavingsTransferModal } from './StartSavingsTransferModal';
import { useStartSavingsController } from './use-start-savings-controller';

const goalId = '22222222-2222-4222-8222-222222222222';
let mockMerchant = 'merchant-1';
const previousEnvironment = { ...process.env };
const environmentKeys = [
  'EXPO_PUBLIC_HOSTED_STOREFRONT',
  'EXPO_PUBLIC_STAGING_TEST_PAYMENTS',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
] as const;
const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ products: [], isLoading: false }),
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({ data: null, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { merchantId: string }) => unknown) =>
    select({ merchantId: mockMerchant }),
}));
jest.mock('@/lib/config', () => ({
  CONFIG: {
    get MERCHANT_ID() {
      return mockMerchant;
    },
    MERCHANT_SLUG: 'ogabassey',
  },
}));
jest.mock('@/lib/customer-savings-api', () => ({
  getCustomerSavingsApiClient: () => ({
    fetchJson: mockFetch,
    buildMerchantIdentifiers: (input: {
      merchantId?: string;
      merchantSlug?: string;
    }) => ({ merchantId: input.merchantId, merchantSlug: input.merchantSlug }),
  }),
}));
jest.mock('./use-start-savings-payment-methods', () => ({
  useStartSavingsPaymentMethods: () => ({ setPaymentMethodsError: jest.fn() }),
}));
jest.mock('./use-start-savings-submit', () => ({
  useStartSavingsSubmit: (input: {
    setCreatedGoalId: (value: string) => void;
    setShowTransferModal: (value: boolean) => void;
  }) => ({
    isSubmitting: false,
    submitSavingsGoal: async () => {
      input.setCreatedGoalId('22222222-2222-4222-8222-222222222222');
      input.setShowTransferModal(true);
    },
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockMerchant = 'merchant-1';
  Object.assign(process.env, {
    EXPO_PUBLIC_HOSTED_STOREFRONT: '1',
    EXPO_PUBLIC_STAGING_TEST_PAYMENTS: '1',
    EXPO_PUBLIC_API_URL: 'https://staging.ogabassey.com',
    EXPO_PUBLIC_SUPABASE_URL: 'https://staging-auth.ogabassey.com',
  });
  mockFetch.mockResolvedValue({ goalId, status: 'pending' });
});
afterEach(() => {
  for (const key of environmentKeys) {
    const previousValue = previousEnvironment[key];
    if (previousValue === undefined) delete process.env[key];
    else process.env[key] = previousValue;
  }
});
function Harness() {
  const controller = useStartSavingsController();
  return (
    <>
      <Button
        title="Create fixture goal"
        onPress={() => {
          void controller.submitSavingsGoal();
        }}
      />
      <StartSavingsTransferModal
        colors={Colors.light}
        controller={controller}
      />
    </>
  );
}
async function openGoal() {
  render(<Harness />);
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Create fixture goal' })
    );
  });
}
it('connects legacy hosted staging parent lookup through actual controller to status-only GET without BVN', async () => {
  await openGoal();
  expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
  expect(
    screen.queryByRole('checkbox', { name: 'Earn interest on this plan' })
  ).toBeNull();
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Check account status' })
    );
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith({
    method: 'GET',
    path: '/api/storefront/customer/savings/funding',
    query: { goalId, merchantId: mockMerchant, merchantSlug: 'ogabassey' },
    signal: undefined,
  });
  expect(
    screen.getByText(
      'Your dedicated account is being prepared. Check again shortly.'
    )
  ).toBeOnTheScreen();
});
it('keeps actual validated primary provisioning and explicit interest consent in hosted staging', async () => {
  mockMerchant = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  await openGoal();
  expect(screen.queryByLabelText('BVN for plan account')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Check account status' })
  ).toBeNull();
  fireEvent.press(
    screen.getByRole('checkbox', { name: 'Earn interest on this plan' })
  );
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith({
    method: 'POST',
    path: '/api/storefront/customer/savings/primary-provisioning',
    includeCsrf: true,
    body: {
      merchantId: mockMerchant,
      goalId,
      consent: true,
      interestAccepted: true,
    },
    signal: undefined,
  });
  expect(
    screen.getByText(
      'Your dedicated account is being prepared. Check again shortly.'
    )
  ).toBeOnTheScreen();
});
it('keeps the legacy BVN requirement outside hosted staging', async () => {
  process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '0';
  await openGoal();
  expect(screen.getByLabelText('BVN for plan account')).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Check account status' })
  ).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});
it('does not display an account from a foreign goal returned to the real primary provisioning path', async () => {
  mockMerchant = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  mockFetch.mockResolvedValue({
    goalId: '33333333-3333-4333-8333-333333333333',
    status: 'ready',
    accounts: [
      {
        accountName: 'Wrong',
        accountNumber: '1234567890',
        bankName: 'Wrong bank',
      },
    ],
  });
  await openGoal();
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Show plan account' }));
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('1234567890')).toBeNull();
  expect(screen.queryByText('Wrong bank')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Confirm plan transfer' })
  ).toBeNull();
});
