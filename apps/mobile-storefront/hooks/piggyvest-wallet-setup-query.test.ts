import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { PIGGYVEST_WALLET_SETUP as policy } from '@/config/piggyvest-wallet-setup';
import { piggyvestPrimaryWalletApi as api } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { piggyvestWalletSetupQuery } from './piggyvest-wallet-setup-query';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));
jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'user' } })) };
});
const ready = {
  account: {
    accountNumber: '9000000012',
    accountName: 'Test',
    bankName: 'Sandbox',
    provider: 'piggyvest' as const,
  },
  provisioningStatus: 'ready' as const,
  requiresConsent: false,
};
it('clears a stale local attempt only when the server confirms setup never started', async () => {
  const client = new QueryClient();
  await AsyncStorage.setItem(`${policy.storagePrefix}merchant:user`, 'pending');
  jest.mocked(api.read).mockResolvedValue({
    account: null,
    provisioningStatus: 'not_started',
    requiresConsent: true,
  });
  const result = await client.fetchQuery(
    piggyvestWalletSetupQuery(client, 'merchant', 'user')
  );
  expect(result.attempted).toBe(false);
  expect(
    await AsyncStorage.getItem(`${policy.storagePrefix}merchant:user`)
  ).toBeNull();
  client.clear();
});
it('reports a server-confirmed pending setup as attempted without a local marker', async () => {
  const client = new QueryClient();
  jest.mocked(api.read).mockResolvedValue({
    account: null,
    provisioningStatus: 'pending',
    requiresConsent: true,
  });

  const result = await client.fetchQuery(
    piggyvestWalletSetupQuery(client, 'merchant', 'user')
  );

  expect(result.attempted).toBe(true);
  client.clear();
});
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useAuthStore.setState({
    user: { id: 'user' } as NonNullable<
      ReturnType<typeof useAuthStore.getState>['user']
    >,
  });
  jest.mocked(api.read).mockResolvedValue(ready);
});
it('shares a bound account result and removes only the completed owner pending marker', async () => {
  const client = new QueryClient();
  await AsyncStorage.setItem(`${policy.storagePrefix}merchant:user`, 'pending');
  await AsyncStorage.setItem(
    `${policy.storagePrefix}merchant:other`,
    'pending'
  );
  const options = piggyvestWalletSetupQuery(client, 'merchant', 'user');
  const [first, second] = await Promise.all([
    client.fetchQuery(options),
    client.fetchQuery(options),
  ]);
  expect(api.read).toHaveBeenCalledTimes(1);
  expect(first.account).toEqual(ready.account);
  expect(second.completedSetup).toBe(true);
  expect(
    await AsyncStorage.getItem(`${policy.storagePrefix}merchant:user`)
  ).toBeNull();
  expect(
    await AsyncStorage.getItem(`${policy.storagePrefix}merchant:other`)
  ).toBe('pending');
  client.clear();
});
it('rejects a late account response after the authenticated user changes', async () => {
  let finish!: (value: typeof ready) => void;
  jest.mocked(api.read).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const client = new QueryClient();
  const options = {
    ...piggyvestWalletSetupQuery(client, 'merchant', 'user'),
    retry: false,
  };
  const pending = client.fetchQuery(options);
  await Promise.resolve();
  await Promise.resolve();
  useAuthStore.setState({
    user: { id: 'other' } as NonNullable<
      ReturnType<typeof useAuthStore.getState>['user']
    >,
  });
  finish(ready);
  await expect(pending).rejects.toThrow('The signed-in account changed.');
  expect(client.getQueryData(options.queryKey)).toBeUndefined();
  client.clear();
});
