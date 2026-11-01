import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { clearImeiRecoveryKey } from '@/lib/imei-request-recovery';
import {
  handleImeiCheckFailure,
  handleImeiPreparationFailure,
  imeiReportScopeKey,
  validateImeiCheckInput,
} from './handle-imei-check-failure';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/imei-request-recovery', () => ({
  clearImeiRecoveryKey: jest
    .fn<() => Promise<void>>()
    .mockResolvedValue(undefined),
}));

const recovery = { storageKey: 'saved-key', idempotencyKey: 'attempt-key' };
const setError = jest.fn<(value: string) => void>();
const onPreviousReport = jest.fn<(id: string) => void>();
const refetchWallet = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
});

function handle(responseStatus: number, rawData: unknown) {
  return handleImeiCheckFailure({
    responseStatus,
    rawData,
    price: 700,
    walletBalance: 200,
    recovery,
    refetchWallet,
    setError,
    onPreviousReport,
  });
}

describe('handleImeiCheckFailure', () => {
  it.each([
    [404, 'PETROCK_REJECTED'],
    [502, 'PETROCK_UNAVAILABLE'],
    [502, 'SICKW_UNAVAILABLE'],
  ])('clears the saved key for a confirmed refund (%s %s)', async (status, code) => {
    await handle(status, {
      success: false,
      status: 'error',
      code,
      error: 'Refunded',
    });
    expect(clearImeiRecoveryKey).toHaveBeenCalledWith(
      'saved-key',
      'attempt-key'
    );
  });
  it.each([
    [502, 'REFUND_PENDING'],
    [503, 'UNKNOWN'],
  ])('preserves the saved key when the result is unresolved (%s %s)', async (status, code) => {
    await handle(status, {
      success: false,
      status: 'error',
      code,
      error: 'Try later',
    });
    expect(clearImeiRecoveryKey).not.toHaveBeenCalled();
  });
  it('records a server-confirmed previous report without clearing the key', async () => {
    const lookupId = '11111111-1111-4111-8111-111111111111';
    await handle(409, {
      success: false,
      code: 'PREVIOUS_REPORT_AVAILABLE',
      error: 'Report available',
      lookupId,
    });
    expect(onPreviousReport).toHaveBeenCalledWith(lookupId);
    expect(clearImeiRecoveryKey).not.toHaveBeenCalled();
  });
  it('routes an expired session to login without clearing recovery', async () => {
    await handle(401, {
      success: false,
      code: 'AUTH_REQUIRED',
      error: 'Unauthorized',
    });
    expect(router.push).toHaveBeenCalledWith(
      '/auth/login?returnTo=/imei-check'
    );
    expect(clearImeiRecoveryKey).not.toHaveBeenCalled();
  });
  it('routes an insufficient balance to wallet funding', async () => {
    await handle(402, {
      success: false,
      code: 'WALLET_INSUFFICIENT',
      balance: 200,
      required: 700,
    });
    expect(router.push).toHaveBeenCalledWith(
      '/wallet?action=fund&requiredAmount=500&returnTo=/imei-check'
    );
    expect(clearImeiRecoveryKey).toHaveBeenCalledWith(
      'saved-key',
      'attempt-key'
    );
  });
  it('refreshes the wallet for a pending refund and displays the pending message', async () => {
    await handle(502, {
      success: false,
      code: 'REFUND_PENDING',
      error: 'Pending',
    });
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith(
      expect.stringContaining('refund is pending')
    );
  });
});

describe('input and preparation handling', () => {
  it('rejects invalid identifiers and accepts a valid IMEI', () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    expect(validateImeiCheckInput('123', 'imei')).toBe(false);
    expect(alert).toHaveBeenCalledWith(
      'Invalid number',
      expect.stringContaining('15-digit')
    );
    expect(validateImeiCheckInput('490154203237518', 'imei')).toBe(true);
    alert.mockRestore();
  });
  it('routes a wallet shortfall and reports storage failures', () => {
    handleImeiPreparationFailure(
      { kind: 'insufficient', shortfall: 400 },
      setError
    );
    expect(router.push).toHaveBeenCalledWith(
      '/wallet?action=fund&requiredAmount=400&returnTo=/imei-check'
    );
    handleImeiPreparationFailure({ kind: 'storage_error' }, setError);
    expect(setError).toHaveBeenCalledWith(
      expect.stringContaining('cannot save check recovery')
    );
  });
  it('scopes report identities and normalizes their identifiers', () => {
    expect(imeiReportScopeKey('merchant:user', 'blacklist', ' ab12 ')).toBe(
      JSON.stringify(['merchant:user', 'blacklist', 'AB12'])
    );
  });
});
