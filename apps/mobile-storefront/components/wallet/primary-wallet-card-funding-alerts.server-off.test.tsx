import { describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import {
  alertPrimaryWalletCardEmailFallback,
  alertPrimaryWalletCardFundingFailure,
} from './primary-wallet-card-funding-alerts';

describe('card funding guidance with the server keeping PiggyVest off', () => {
  it('reports a failure through the wallet notice, never an iOS alert', () => {
    const iosAlert = jest.spyOn(Alert, 'alert');
    const notify = jest.fn();

    alertPrimaryWalletCardFundingFailure(new Error('offline'), notify);

    expect(notify).toHaveBeenCalledWith(
      'Card funding could not be confirmed',
      expect.stringContaining('retained'),
      'warning'
    );
    expect(iosAlert).not.toHaveBeenCalled();
  });

  it('nudges the email fallback as an info notice', () => {
    const notify = jest.fn();

    alertPrimaryWalletCardEmailFallback(notify);

    expect(notify).toHaveBeenCalledWith(
      'Verify your email for card funding',
      expect.stringContaining('standard top-up')
    );
  });
});
