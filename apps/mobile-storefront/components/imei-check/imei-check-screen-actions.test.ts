import { describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { imeiCheckScreenActions } from './imei-check-screen-actions';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

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
  it('prefills the card top-up minimum for a ₦50 shortfall', () => {
    imeiCheckScreenActions.fundWallet(50);

    expect(router.push).toHaveBeenLastCalledWith(
      '/wallet?action=fund&requiredAmount=100&returnTo=/imei-check'
    );
  });
});
