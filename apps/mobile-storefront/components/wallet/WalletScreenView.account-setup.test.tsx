import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { WalletScreenView } from './WalletScreenView';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
  };
});
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn(), create: jest.fn() },
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => true,
}));
jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');
  return {
    useAuthStore: create(() => ({
      user: { id: 'user-a' },
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      customer: {
        id: 'customer-a',
        first_name: 'Sandbox',
        last_name: 'Customer',
        phone: '08012345678',
      },
    })),
  };
});
jest.mock('@/hooks/use-product-search', () => ({
  useProductSearch: () => ({ isLoading: false, products: [] }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const pending = {
  account: null,
  provisioningStatus: 'pending' as const,
  requiresConsent: true,
};
const ready = {
  provisioningStatus: 'ready' as const,
  requiresConsent: false,
  account: {
    accountNumber: '9000000012',
    accountName: 'Sandbox Customer',
    bankName: 'Sandbox Bank',
    provider: 'piggyvest' as const,
  },
};
const clients: QueryClient[] = [];
configure({ asyncUtilTimeout: 1000 });
jest.setTimeout(15000);

function openWallet(open = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <WalletScreenView
        colors={Colors.dark}
        presentation="tab"
        walletContentProps={{
          ...createWalletContentProps(),
          merchantId,
          fundingAccount: null,
          showFundPanel: open,
          activeSavingsGoal: null,
        }}
      />
    </QueryClientProvider>
  );
}

async function submitSetup() {
  await waitFor(() => expect(screen.getByLabelText('BVN')).toBeOnTheScreen());
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue(pending);
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue({
    account: null,
    provisioningStatus: 'not_started',
    requiresConsent: true,
  });
  jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue(pending);
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  jest.useRealTimers();
});

it('shows an already-created account on app reopen even when the wallet projection has no account', async () => {
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue(ready);
  openWallet(false);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Copy funding account number' })
    ).toBeOnTheScreen()
  );
  expect(screen.getByText('9000000012')).toBeOnTheScreen();
  expect(screen.getByText('Sandbox Bank')).toBeOnTheScreen();
  expect(piggyvestPrimaryWalletApi.create).not.toHaveBeenCalled();
});

it('automatically replaces pending setup with the verified account without pressing refresh', async () => {
  openWallet();
  await submitSetup();
  await waitFor(() =>
    expect(screen.getByText('Setting up your account')).toBeOnTheScreen()
  );
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue(ready);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Copy wallet account number' })
    ).toBeOnTheScreen()
  );
  expect(screen.queryByText('Setting up your account')).toBeNull();
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(piggyvestPrimaryWalletApi.create).toHaveBeenCalledTimes(1);
});

it('resumes pending setup with a fresh query cache after the app closes, without resubmitting BVN', async () => {
  const first = openWallet();
  await submitSetup();
  await waitFor(() =>
    expect(screen.getByText('Setting up your account')).toBeOnTheScreen()
  );
  first.unmount();
  clients[0].clear();
  const second = openWallet();
  await waitFor(() =>
    expect(screen.getByText('Setting up your account')).toBeOnTheScreen()
  );
  expect(screen.queryByLabelText('BVN')).toBeNull();
  second.unmount();
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue(ready);
  openWallet(false);
  await waitFor(() => expect(screen.getByText('9000000012')).toBeOnTheScreen());
  expect(piggyvestPrimaryWalletApi.create).toHaveBeenCalledTimes(1);
  const values = await Promise.all(
    (await AsyncStorage.getAllKeys()).map((key) => AsyncStorage.getItem(key))
  );
  expect(JSON.stringify(values)).not.toContain('12345678901');
});

it('keeps checking a lost creation response after restart instead of creating a duplicate wallet', async () => {
  jest
    .mocked(piggyvestPrimaryWalletApi.create)
    .mockRejectedValue(new Error('Network request failed'));
  const first = openWallet();
  await submitSetup();
  await waitFor(() =>
    expect(screen.getByText('Setting up your account')).toBeOnTheScreen()
  );
  first.unmount();
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue(ready);
  openWallet();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Copy wallet account number' })
    ).toBeOnTheScreen()
  );
  expect(piggyvestPrimaryWalletApi.create).toHaveBeenCalledTimes(1);
});
