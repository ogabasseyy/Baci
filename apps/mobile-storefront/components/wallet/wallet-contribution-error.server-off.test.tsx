import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { reportContributionError } from './wallet-contribution-error';

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

beforeEach(() => {
  alertSpy.mockClear();
});

// Legacy wallet failures keep their messages and never lose the stored id
// unless the server cancelled the reservation.
describe('contribution errors with the server off', () => {
  it('reports a plain failure and keeps the stored operation', () => {
    const release = jest.fn();
    reportContributionError(new Error('boom'), release);
    expect(alertSpy).toHaveBeenCalledWith('Unable to add savings', 'boom');
    expect(release).not.toHaveBeenCalled();
  });

  it('keeps the id and asks for money on insufficient funds', () => {
    const release = jest.fn();
    reportContributionError(
      Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }),
      release
    );
    expect(alertSpy).toHaveBeenCalledWith(
      'Not enough money in your wallet',
      'Add money to your wallet, then try again.'
    );
    expect(release).not.toHaveBeenCalled();
  });

  it('releases the id when the wallet reservation was cancelled', () => {
    const release = jest.fn();
    reportContributionError(
      Object.assign(new Error('gone'), { code: 'WALLET_UNAVAILABLE' }),
      release
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message for a non-Error rejection', () => {
    reportContributionError('nope');
    expect(alertSpy).toHaveBeenCalledWith(
      'Unable to add savings',
      'Please try again in a moment.'
    );
  });
});
