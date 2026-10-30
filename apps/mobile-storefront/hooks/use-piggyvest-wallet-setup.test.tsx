import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { PIGGYVEST_WALLET_SETUP as policy } from '@/config/piggyvest-wallet-setup';
import { piggyvestPrimaryWalletApi as api } from '@/lib/piggyvest-primary-wallet';
import { useAuthStore } from '@/stores/auth-store';
import { usePiggyvestWalletSetup } from './use-piggyvest-wallet-setup';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn(), create: jest.fn() },
}));
jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'user-a' } })) };
});
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const input = { merchantId, bvn: '12345678901', consent: true };
const storageKey = `${policy.storagePrefix}${merchantId}:user-a`;
const pending = {
  account: null,
  provisioningStatus: 'pending' as const,
  requiresConsent: true,
};
const notStarted = { ...pending, provisioningStatus: 'not_started' as const };
const ready = {
  account: {
    accountNumber: '9000000012',
    accountName: 'Test Customer',
    bankName: 'Sandbox Bank',
    provider: 'piggyvest' as const,
  },
  provisioningStatus: 'ready' as const,
  requiresConsent: false,
};
const clients: QueryClient[] = [];
const listeners = new Set<(state: AppStateStatus) => void>();

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return renderHook(
    ({ userId }: { userId: string }) =>
      usePiggyvestWalletSetup(merchantId, userId),
    {
      initialProps: { userId: 'user-a' },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  );
}

async function moveApp(state: AppStateStatus) {
  await act(async () => {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: state,
    });
    for (const listener of listeners) listener(state);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.clear();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    });
  onlineManager.setOnline(true);
  useAuthStore.setState({
    user: {
      id: 'user-a',
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-10-13T00:00:00Z',
    },
  });
  await AsyncStorage.clear();
  jest.mocked(api.read).mockResolvedValue(pending);
  jest.mocked(api.create).mockResolvedValue(pending);
});
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  listeners.clear();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('stops automatic polling after a minute and resumes safely on foreground', async () => {
  await AsyncStorage.setItem(storageKey, 'pending');
  const { result } = mount();
  await waitFor(() => expect(result.current.state).toBe('processing'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(policy.pollingWindowMs);
  });
  expect(result.current.delayed).toBe(true);
  const calls = jest.mocked(api.read).mock.calls.length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(policy.pollingIntervalMs * 3);
  });
  expect(api.read).toHaveBeenCalledTimes(calls);
  jest.mocked(api.read).mockResolvedValue(ready);
  await moveApp('background');
  await moveApp('active');
  await waitFor(() => expect(result.current.account).toEqual(ready.account));
  expect(api.create).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(storageKey)).toBeNull();
});

it('recovers server-pending setup without a local marker and polls it to completion', async () => {
  expect(await AsyncStorage.getItem(storageKey)).toBeNull();
  const { result } = mount();
  await waitFor(() => expect(result.current.state).toBe('processing'));
  jest.mocked(api.read).mockResolvedValue(ready);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(policy.pollingIntervalMs);
  });

  await waitFor(() => expect(result.current.state).toBe('ready'));
  expect(result.current.account).toEqual(ready.account);
  expect(api.create).not.toHaveBeenCalled();
});

it('pauses polling while the app is backgrounded', async () => {
  await AsyncStorage.setItem(storageKey, 'pending');
  const { result } = mount();
  await waitFor(() => expect(result.current.state).toBe('processing'));
  await moveApp('background');
  const calls = jest.mocked(api.read).mock.calls.length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(15000);
  });
  expect(api.read).toHaveBeenCalledTimes(calls);
});

it('discovers the account after reconnect without another creation request', async () => {
  await AsyncStorage.setItem(storageKey, 'pending');
  const { result } = mount();
  await waitFor(() => expect(result.current.state).toBe('processing'));
  act(() => onlineManager.setOnline(false));
  jest.mocked(api.read).mockResolvedValue(ready);
  await act(async () => {
    onlineManager.setOnline(true);
  });
  await waitFor(() => expect(result.current.account).toEqual(ready.account));
  expect(api.create).not.toHaveBeenCalled();
});

it('retains an ambiguous setup across a failed read and retries status only', async () => {
  await AsyncStorage.setItem(storageKey, 'pending');
  jest.mocked(api.read).mockRejectedValue(new Error('Offline'));
  const { result } = mount();
  await waitFor(() => expect(result.current.hasCheckError).toBe(true), {
    timeout: 2500,
  });
  expect(await AsyncStorage.getItem(storageKey)).toBe('pending');
  jest.mocked(api.read).mockResolvedValue(ready);
  await act(async () => {
    result.current.refresh();
  });
  await waitFor(() => expect(result.current.state).toBe('ready'));
  expect(api.create).not.toHaveBeenCalled();
});

it('never submits the BVN when the pending marker cannot be saved', async () => {
  jest.mocked(api.read).mockResolvedValue(notStarted);
  const { result } = mount();
  await waitFor(() => expect(result.current.state).toBe('not_started'));
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockRejectedValueOnce(new Error('Storage unavailable'));
  await act(async () => {
    await expect(result.current.submit(input)).rejects.toThrow(
      'Storage unavailable'
    );
  });
  expect(api.create).not.toHaveBeenCalled();
  expect(result.current.submitting).toBe(false);
});

it('allows corrected details after an explicit BVN rejection', async () => {
  jest.mocked(api.read).mockResolvedValue(notStarted);
  const { result } = mount();
  await waitFor(() => expect(result.current.state).toBe('not_started'));
  jest
    .mocked(api.create)
    .mockRejectedValueOnce(
      Object.assign(new Error('Check BVN'), { code: 'INVALID_BVN' })
    );
  await act(async () => {
    await expect(result.current.submit(input)).rejects.toThrow('Check BVN');
  });
  expect(await AsyncStorage.getItem(storageKey)).toBeNull();
  expect(result.current.state).toBe('not_started');
});

it('does not publish a late creation result into a different signed-in customer', async () => {
  jest.mocked(api.read).mockResolvedValue(notStarted);
  let resolveCreation: (value: typeof ready) => void = () => undefined;
  jest.mocked(api.create).mockReturnValue(
    new Promise((resolve) => {
      resolveCreation = resolve;
    })
  );
  const { result, rerender } = mount();
  await waitFor(() => expect(result.current.state).toBe('not_started'));
  let submission: Promise<void> | undefined;
  await act(async () => {
    submission = result.current.submit(input);
  });
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  act(() => {
    useAuthStore.setState({
      user: {
        id: 'user-b',
        aud: 'authenticated',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-10-13T00:00:00Z',
      },
    });
  });
  rerender({ userId: 'user-b' });
  await act(async () => {
    resolveCreation(ready);
    await submission;
  });
  await waitFor(() => expect(result.current.state).toBe('not_started'));
  expect(result.current.account).toBeNull();
  expect(await AsyncStorage.getItem(storageKey)).toBe('pending');
});

it('announces completion once and acknowledges it without losing the account', async () => {
  await AsyncStorage.setItem(storageKey, 'pending');
  jest.mocked(api.read).mockResolvedValue(ready);
  const { result } = mount();
  await waitFor(() => expect(result.current.justCreated).toBe(true));
  await act(async () => {
    result.current.refresh();
  });
  await waitFor(() => expect(result.current.isChecking).toBe(false));
  expect(result.current.justCreated).toBe(true);
  act(() => {
    result.current.acknowledgeReady();
  });
  await waitFor(() => expect(result.current.justCreated).toBe(false));
  expect(result.current.account).toEqual(ready.account);
});
