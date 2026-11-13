import { describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { imeiCheckScreenActions } from './imei-check-screen-actions';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// The server rules PiggyVest out unless a test says otherwise.
let mockCapabilityNow: boolean | null = false;
jest.mock('@/lib/read-piggyvest-capability-now', () => ({
  readPiggyvestCapabilityNow: () => mockCapabilityNow,
}));

describe('imeiCheckScreenActions', () => {
  it('rounds a wallet shortfall up and preserves the return route', () => {
    imeiCheckScreenActions.fundWallet(999.2);

    expect(router.push).toHaveBeenCalledWith(
      '/wallet?action=fund&requiredAmount=1000&returnTo=/imei-check'
    );
  });

  it('distinguishes request timeouts from other network errors', () => {
    const timeout = new Error('timeout');
    timeout.name = 'AbortError';

    expect(imeiCheckScreenActions.networkErrorMessage(timeout)).toMatch(
      /timed out/i
    );
    expect(
      imeiCheckScreenActions.networkErrorMessage(new Error('offline'))
    ).toMatch(/network error/i);
  });
});

describe('imeiCheckScreenActions.alertInvalidIdentifier', () => {
  it('names the serial number for serial-only checks', () => {
    const { Alert } =
      jest.requireActual<typeof import('react-native')>('react-native');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    imeiCheckScreenActions.alertInvalidIdentifier('serial');

    expect(alert).toHaveBeenCalledWith(
      'Invalid serial',
      'Please enter a valid device serial number.'
    );
  });
});

describe('bugfix: IMEI shortfall below the card minimum', () => {
  it('prefills the card top-up minimum for a ₦50 store credit shortfall', () => {
    mockCapabilityNow = true;
    imeiCheckScreenActions.fundWallet(50, true);
    mockCapabilityNow = false;

    expect(router.push).toHaveBeenLastCalledWith(
      '/wallet?action=fund&requiredAmount=100&returnTo=/imei-check'
    );
  });

  it('keeps the exact ₦50 prefill for customers without PiggyVest', () => {
    imeiCheckScreenActions.fundWallet(50);

    expect(router.push).toHaveBeenLastCalledWith(
      '/wallet?action=fund&requiredAmount=50&returnTo=/imei-check'
    );
  });
});

describe('bugfix: IMEI request settles after PiggyVest turned on', () => {
  it('clamps to the card minimum when the verdict turned positive mid-request', () => {
    // Arrange: rendered as legacy (storeCredit false), verdict now positive.
    mockCapabilityNow = true;

    // Act
    imeiCheckScreenActions.fundWallet(50);
    mockCapabilityNow = false;

    // Assert: the wallet sheet will show the card-only store credit form.
    expect(router.push).toHaveBeenLastCalledWith(
      '/wallet?action=fund&requiredAmount=100&returnTo=/imei-check'
    );
  });
});

describe('bugfix: IMEI request settles after PiggyVest was switched off', () => {
  it('keeps the exact shortfall when the live verdict rolled back mid-request', () => {
    // Arrange: rendered as store credit (captured true); now ruled out.
    mockCapabilityNow = false;

    // Act
    imeiCheckScreenActions.fundWallet(50, true);

    // Assert: a legacy top-up of exactly what the check needs.
    expect(router.push).toHaveBeenLastCalledWith(
      '/wallet?action=fund&requiredAmount=50&returnTo=/imei-check'
    );
  });
});
