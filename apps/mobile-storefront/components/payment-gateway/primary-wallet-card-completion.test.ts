import { beforeEach, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { PaymentGatewayRefs } from './payment-gateway-controller.types';

const mockRecover = jest.fn<(...args: unknown[]) => Promise<unknown>>();
let mockUserId = '11111111-1111-4111-8111-111111111111';
jest.mock('@/lib/primary-wallet-card', () => ({
  createPrimaryWalletCardFundingClient: () => ({ recover: mockRecover }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: mockUserId } }),
  },
}));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
const { beginPrimaryWalletCardCompletion } =
  require('./primary-wallet-card-completion') as typeof import('./primary-wallet-card-completion');
function fixture() {
  return {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    gateway: 'paystack',
    reference: 'pvb-first-primary-22222222-2222-4222-8222-222222222222',
    clearPendingLoadTimeout: jest.fn(),
    setPaymentStatus: jest.fn(),
    setErrorMessage: jest.fn(),
    scheduleDelayedNavigation: jest.fn((navigate: () => void) => navigate()),
    queryClient: {
      invalidateQueries: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
    } as unknown as QueryClient,
    refs: {
      isMountedRef: { current: true },
      paymentCompletionStartedRef: { current: false },
    } as PaymentGatewayRefs,
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = '11111111-1111-4111-8111-111111111111';
});
it('does not show another account a completed result when auth switches during recovery', async () => {
  const input = fixture();
  mockRecover.mockImplementationOnce(async () => {
    mockUserId = '33333333-3333-4333-8333-333333333333';
    return { status: 'completed', returnTo: '/wallet?action=savings' };
  });
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(input.queryClient.invalidateQueries).not.toHaveBeenCalled();
  expect(input.setPaymentStatus).not.toHaveBeenCalledWith('success');
  expect(router.replace).not.toHaveBeenCalled();
});
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
it.each([
  'reserved',
  'initializing',
  'ready',
  'custody_pending',
  'init_unknown',
  'reconciliation_required',
])('never treats checkout/callback %s as wallet credit', async (status) => {
  const input = fixture();
  mockRecover.mockResolvedValue({ status });
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(input.setPaymentStatus).not.toHaveBeenCalledWith('success');
  expect(input.setPaymentStatus).toHaveBeenLastCalledWith('pending');
  expect(input.setPaymentStatus).not.toHaveBeenCalledWith('error');
  expect(input.setErrorMessage).toHaveBeenCalledWith(
    expect.stringContaining('Do not pay again')
  );
  expect(input.queryClient.invalidateQueries).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(input.refs.paymentCompletionStartedRef.current).toBe(false);
});
it('treats an abandoned checkout as cancelled with retry copy, never credit', async () => {
  const input = fixture();
  mockRecover.mockResolvedValue({ status: 'abandoned' });
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(input.setPaymentStatus).toHaveBeenLastCalledWith('error');
  expect(input.setPaymentStatus).not.toHaveBeenCalledWith('success');
  expect(input.setPaymentStatus).not.toHaveBeenCalledWith('pending');
  expect(input.setErrorMessage).toHaveBeenCalledWith(
    expect.stringContaining('Start a new funding to try again')
  );
  expect(input.setErrorMessage).toHaveBeenCalledWith(
    expect.not.stringContaining('Do not pay again')
  );
  expect(input.queryClient.invalidateQueries).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(input.refs.paymentCompletionStartedRef.current).toBe(false);
});
it('shows a status-check failure, not a failed charge, and permits read-only retry', async () => {
  const input = fixture();
  mockRecover.mockRejectedValueOnce(new Error('Network unavailable'));
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(input.setPaymentStatus).toHaveBeenLastCalledWith('error');
  expect(input.setErrorMessage).toHaveBeenCalledWith(
    expect.stringContaining('Could not check your funding status')
  );
  expect(input.refs.paymentCompletionStartedRef.current).toBe(false);
  expect(input.queryClient.invalidateQueries).not.toHaveBeenCalled();
  mockRecover.mockResolvedValueOnce({ status: 'custody_pending' });
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(mockRecover).toHaveBeenCalledTimes(2);
  expect(input.setPaymentStatus).toHaveBeenLastCalledWith('pending');
  expect(router.replace).not.toHaveBeenCalled();
});
it.each([
  ['account_changed', '33333333-3333-4333-8333-333333333333', 'completed'],
  ['recovery_unconfirmed', '11111111-1111-4111-8111-111111111111', 'error'],
])('logs a redacted %s cause without provider detail', async (cause, switchTo, outcome) => {
  const input = fixture();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    if (outcome === 'error') {
      mockRecover.mockRejectedValueOnce(
        new Error('Network unavailable token=secret')
      );
    } else {
      mockRecover.mockImplementationOnce(async () => {
        mockUserId = switchTo;
        return { status: 'completed', returnTo: '/wallet' };
      });
    }
    beginPrimaryWalletCardCompletion(input);
    await flush();
    expect(warn).toHaveBeenCalledWith(
      `[primary-wallet-card] completion failed: ${cause}`
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  } finally {
    warn.mockRestore();
  }
});
it('refreshes and resumes only authoritative completed custody without legacy confirmation', async () => {
  const input = fixture();
  mockRecover.mockResolvedValue({ status: 'completed', returnTo: '/wallet' });
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(mockRecover).toHaveBeenCalledWith({
    merchantId: input.merchantId,
    userId: '11111111-1111-4111-8111-111111111111',
    reference: input.reference,
  });
  expect(input.setPaymentStatus).toHaveBeenCalledWith('success');
  expect(input.queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/wallet');
});
it('recovers a non-pilot merchant without consulting the volatile capability cache', async () => {
  const input = fixture();
  input.merchantId = '00000000-0000-4000-8000-000000000000';
  mockRecover.mockResolvedValue({ status: 'completed', returnTo: '/wallet' });
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(mockRecover).toHaveBeenCalledWith({
    merchantId: input.merchantId,
    userId: '11111111-1111-4111-8111-111111111111',
    reference: input.reference,
  });
  expect(input.setPaymentStatus).toHaveBeenCalledWith('success');
});
it('ignores duplicate callbacks and does not update unmounted UI', async () => {
  const input = fixture();
  input.refs.isMountedRef.current = false;
  mockRecover.mockResolvedValue({ status: 'completed' });
  beginPrimaryWalletCardCompletion(input);
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(mockRecover).toHaveBeenCalledTimes(1);
  expect(input.setPaymentStatus).not.toHaveBeenCalledWith('success');
});
it('releases the completion guard after an unmounted attempt so retry stays possible', async () => {
  const input = fixture();
  input.refs.isMountedRef.current = false;
  mockRecover.mockResolvedValue({ status: 'completed' });
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(input.refs.paymentCompletionStartedRef.current).toBe(false);
  input.refs.isMountedRef.current = true;
  beginPrimaryWalletCardCompletion(input);
  await flush();
  expect(mockRecover).toHaveBeenCalledTimes(2);
  expect(input.setPaymentStatus).toHaveBeenCalledWith('success');
});
