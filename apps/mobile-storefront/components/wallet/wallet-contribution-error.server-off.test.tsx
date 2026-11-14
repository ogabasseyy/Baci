import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { TimeoutError } from '@/lib/fetch-with-timeout';
import { notifySavings } from './savings/savings-notice';
import {
  reportContributionError,
  UNCONFIRMED_CONTRIBUTION_MESSAGE,
} from './wallet-contribution-error';

jest.mock('./savings/savings-notice', () => {
  const notifySavings = jest.fn();
  return { notifySavings, savingsNotifier: () => notifySavings };
});
const noticeSpy = jest.mocked(notifySavings);

beforeEach(() => {
  noticeSpy.mockClear();
});

// Legacy wallet failures keep their messages and never lose the stored id
// unless the server cancelled the reservation.
describe('contribution errors with the server off', () => {
  it('reports a plain failure and keeps the stored operation', () => {
    const release = jest.fn();
    reportContributionError(new Error('boom'), release);
    expect(noticeSpy).toHaveBeenCalledWith(
      'Unable to add savings',
      'boom',
      'warning'
    );
    expect(release).not.toHaveBeenCalled();
  });

  it('keeps the id and asks for money on insufficient funds', () => {
    const release = jest.fn();
    reportContributionError(
      Object.assign(new Error('x'), { code: 'INSUFFICIENT_FUNDS' }),
      release
    );
    expect(noticeSpy).toHaveBeenCalledWith(
      'Not enough money in your wallet',
      'Add money to your wallet, then try again.',
      'warning'
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

  it('treats a non-Error rejection as an unconfirmed outcome', () => {
    reportContributionError('nope');
    expect(noticeSpy).toHaveBeenCalledWith(
      'Still confirming your savings',
      UNCONFIRMED_CONTRIBUTION_MESSAGE,
      'warning'
    );
  });

  // Walk 14: "Request timed out after 30000ms" reached the customer.
  // Walk 15: "Please try again" sat above "don't start another payment".
  it('says a timed-out contribution is still being confirmed, never "try again"', () => {
    const release = jest.fn();
    reportContributionError(new TimeoutError(30000), release);
    expect(noticeSpy).toHaveBeenCalledWith(
      'Still confirming your savings',
      UNCONFIRMED_CONTRIBUTION_MESSAGE,
      'warning'
    );
    expect(release).not.toHaveBeenCalled();
  });
});
