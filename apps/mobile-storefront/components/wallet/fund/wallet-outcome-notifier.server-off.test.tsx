import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { walletOutcomeNotifier } from './wallet-outcome-notifier';

const mockNotify = jest.fn();
jest.mock('../savings/savings-notifier', () => ({
  savingsNotifier: () => mockNotify,
}));
jest.mock('@/lib/piggyvest-primary-capability-cache', () => ({
  readObservedPiggyvestPrimaryCapability: () => null,
}));

const PIGGYVEST_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const OTHER_MERCHANT = '11111111-1111-4111-8111-111111111111';

describe('wallet outcomes with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps today’s iOS alert, word for word, for any other store', () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    walletOutcomeNotifier(OTHER_MERCHANT)(
      { title: 'Check the amount', message: 'Too small', tone: 'warning' },
      { title: 'Invalid Amount', message: 'Too small' }
    );

    expect(iosAlert).toHaveBeenCalledWith('Invalid Amount', 'Too small');
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('keeps the alert for a missing store too (slug-only funding)', () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    walletOutcomeNotifier(undefined)(
      { title: 'x' },
      { title: 'Top-up Failed', message: 'offline' }
    );
    expect(iosAlert).toHaveBeenCalledWith('Top-up Failed', 'offline');
  });

  it('passes today’s buttons through unchanged', () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onPress = jest.fn();
    walletOutcomeNotifier(OTHER_MERCHANT)(
      { title: 'Points redeemed' },
      {
        title: 'Points Redeemed!',
        message: 'Done',
        buttons: [{ text: 'OK', onPress }],
      }
    );
    expect(iosAlert).toHaveBeenCalledWith('Points Redeemed!', 'Done', [
      { text: 'OK', onPress },
    ]);
  });

  it('uses the inline wallet notice only for the PiggyVest merchant', () => {
    const iosAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    walletOutcomeNotifier(PIGGYVEST_MERCHANT)(
      { title: 'Check the amount', message: 'Too small', tone: 'warning' },
      { title: 'Invalid Amount', message: 'Too small' }
    );

    expect(mockNotify).toHaveBeenCalledWith(
      'Check the amount',
      'Too small',
      'warning'
    );
    expect(iosAlert).not.toHaveBeenCalled();
  });
});
