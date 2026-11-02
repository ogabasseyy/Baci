import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
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
const pending = {
  account: null,
  provisioningStatus: 'pending' as const,
  requiresConsent: true,
  recoverable: false,
};
const queryKey = ['piggyvest-wallet-setup', merchantId, 'user-a'];
const clients: QueryClient[] = [];

function mount() {
  const client = new QueryClient();
  clients.push(client);
  const view = renderHook(() => usePiggyvestWalletSetup(merchantId, 'user-a'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...view, client };
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
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
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('allows BVN resubmission only after GET confirms the pending intent is recoverable', async () => {
  jest.mocked(api.read).mockResolvedValue({ ...pending, recoverable: true });
  const { result } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));

  expect(api.create).not.toHaveBeenCalled();
  await act(async () => result.current.submit(input));
  expect(api.create).not.toHaveBeenCalled();
  await act(async () => result.current.recover(input));

  expect(api.create).toHaveBeenCalledWith(input, 'user-a');
});

it('blocks recovery when a fresh status read finds an ownership review hold', async () => {
  jest
    .mocked(api.read)
    .mockResolvedValueOnce({ ...pending, recoverable: true })
    .mockRejectedValueOnce(
      Object.assign(new Error('review'), { code: 'OWNERSHIP_REVIEW_REQUIRED' })
    );
  const { result } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));

  await act(async () => {
    await expect(result.current.recover(input)).rejects.toMatchObject({
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
  });

  expect(api.read).toHaveBeenCalledTimes(2);
  expect(api.create).not.toHaveBeenCalled();
  expect(result.current.reviewRequired).toBe(true);
});

it('does not create when the recovery preflight fails transiently', async () => {
  jest
    .mocked(api.read)
    .mockResolvedValueOnce({ ...pending, recoverable: true })
    .mockRejectedValueOnce(new Error('network unavailable'));
  const { result } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));

  await act(async () => {
    await expect(result.current.recover(input)).rejects.toThrow(
      'network unavailable'
    );
  });

  expect(api.create).not.toHaveBeenCalled();
  expect(result.current.recoverable).toBe(false);
});

it('revokes cached recovery when the fresh intent is no longer recoverable', async () => {
  jest
    .mocked(api.read)
    .mockResolvedValueOnce({ ...pending, recoverable: true })
    .mockResolvedValueOnce(pending);
  const { result } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));
  await act(async () => {
    await expect(result.current.recover(input)).rejects.toMatchObject({
      code: 'RECOVERY_NOT_AVAILABLE',
    });
  });
  expect(result.current.recoverable).toBe(false);
  expect(result.current.state).toBe('processing');
  expect(api.create).not.toHaveBeenCalled();
});

it('shows an account found by preflight without submitting BVN again', async () => {
  const account = {
    provider: 'piggyvest' as const,
    accountName: 'Synthetic wallet',
    accountNumber: '1234567890',
    bankName: 'Synthetic bank',
  };
  jest
    .mocked(api.read)
    .mockResolvedValueOnce({ ...pending, recoverable: true })
    .mockResolvedValueOnce({
      ...pending,
      account,
      provisioningStatus: 'ready',
    });
  const { result } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));
  await act(async () => {
    await expect(result.current.recover(input)).rejects.toMatchObject({
      code: 'RECOVERY_NOT_AVAILABLE',
    });
  });
  expect(result.current.account).toEqual(account);
  expect(result.current.state).toBe('ready');
  expect(api.create).not.toHaveBeenCalled();
});

it('returns to setup when preflight finds no onboarding intent', async () => {
  jest
    .mocked(api.read)
    .mockResolvedValueOnce({ ...pending, recoverable: true })
    .mockResolvedValueOnce({ ...pending, provisioningStatus: 'not_started' });
  const { result } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));
  await act(async () => {
    await expect(result.current.recover(input)).rejects.toMatchObject({
      code: 'RECOVERY_NOT_AVAILABLE',
    });
  });
  expect(result.current.state).toBe('not_started');
  expect(result.current.recoverable).toBe(false);
  expect(api.create).not.toHaveBeenCalled();
});

it('creates once after the fresh recovery preflight confirms eligibility', async () => {
  jest.mocked(api.read).mockResolvedValue({ ...pending, recoverable: true });
  const { result } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));

  await act(async () => result.current.recover(input));

  expect(api.read).toHaveBeenCalledTimes(2);
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.create).toHaveBeenCalledWith(input, 'user-a');
});

it('does not submit BVN for pending intents without server recovery approval', async () => {
  const { result } = mount();
  await waitFor(() => expect(result.current.state).toBe('processing'));

  await act(async () => result.current.submit(input));

  expect(api.create).not.toHaveBeenCalled();
});

it.each([
  'OWNERSHIP_REVIEW_REQUIRED',
  'INTEREST_ROUTING_REVIEW_REQUIRED',
])('keeps terminal %s holds out of the recovery path', async (code) => {
  jest
    .mocked(api.read)
    .mockRejectedValue(
      Object.assign(new Error('unsafe provider message'), { code })
    );
  const { result } = mount();

  await waitFor(() => expect(result.current.reviewRequired).toBe(true));
  expect(result.current.recoverable).toBe(false);
  expect(result.current.state).toBe('unavailable');
  await act(async () => result.current.submit(input));
  expect(api.create).not.toHaveBeenCalled();
});

it('closes recovery immediately when the guarded POST returns a review hold', async () => {
  jest.mocked(api.read).mockResolvedValue({ ...pending, recoverable: true });
  jest.mocked(api.create).mockRejectedValue(
    Object.assign(new Error('unsafe provider message'), {
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    })
  );
  const { result, client } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));

  await act(async () => {
    await expect(result.current.recover(input)).rejects.toMatchObject({
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
  });

  expect(result.current.reviewRequired).toBe(true);
  expect(result.current.recoverable).toBe(false);
  act(() => result.current.refresh());
  await waitFor(() =>
    expect(client.getQueryData(queryKey)).toMatchObject({ recoverable: true })
  );
  expect(result.current.recoverable).toBe(false);
  await act(async () => result.current.recover(input));
  expect(api.create).toHaveBeenCalledTimes(1);
});

it.each([
  ['PIGGYVEST_UNAVAILABLE', 503],
  ['OWNERSHIP_REVIEW_REQUIRED', 409],
  ['INTEREST_ROUTING_REVIEW_REQUIRED', 409],
])('blocks cached recovery eligibility after a %s refresh failure', async (code, status) => {
  jest.mocked(api.read).mockResolvedValue({ ...pending, recoverable: true });
  const { result, client } = mount();
  await waitFor(() => expect(result.current.recoverable).toBe(true));
  jest
    .mocked(api.read)
    .mockRejectedValue(
      Object.assign(new Error('Untrusted response'), { code, status })
    );

  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.hasCheckError).toBe(true), {
    timeout: 2500,
  });
  expect(client.getQueryData(queryKey)).toMatchObject({ recoverable: true });
  const recoverableAfterFailure = result.current.recoverable;
  await act(async () => result.current.recover(input));

  expect(api.create).not.toHaveBeenCalled();
  expect(recoverableAfterFailure).toBe(false);
});
