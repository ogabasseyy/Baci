import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  trackWalletPayPurchase,
  walletPayPurchaseKeys,
} from './wallet-pay-purchase-keys';

beforeEach(async () => {
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
});
afterEach(() => jest.restoreAllMocks());

describe('bugfix: a key still open after seven days was dropped on restart (Codex P1)', () => {
  it('keeps an unsettled key however old it is, so no second payment starts', async () => {
    await walletPayPurchaseKeys.keyFor('imei|u|m|basic|hash', () => 'first');
    // A month later (a payment still under review), after a restart.
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 30 * 24 * 60 * 60 * 1000);
    walletPayPurchaseKeys.resetMemory();
    await expect(
      walletPayPurchaseKeys.keyFor('imei|u|m|basic|hash', () => 'second')
    ).resolves.toBe('first');
  });

  it('still frees the key once the purchase settles', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'first');
    await walletPayPurchaseKeys.forget('p');
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'next')).resolves.toBe(
      'next'
    );
  });
});

describe('bugfix: a price refusal kept replaying the old price (Muse)', () => {
  // The refused payment was only issued (no PIN asked, nothing moved): its
  // key is forgotten so starting again reaches today's price.
  it('settles the key, so the next start mints a new one', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'issued');
    const refused = {
      kind: 'outcome',
      outcome: { kind: 'failed', failedReason: 'price_changed' },
    };
    const onSettled = jest.fn();
    await trackWalletPayPurchase(
      {
        start: jest.fn(async () => refused as never),
        verifyPin: jest.fn(),
        pay: jest.fn(),
      },
      'p',
      { onSettled, stillOwner: () => true }
    ).start();
    expect(onSettled).toHaveBeenCalled();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'new')).resolves.toBe(
      'new'
    );
  });
});

describe('bugfix: a malformed saved entry was dropped instead of failing closed (Codex P2)', () => {
  it('refuses to mint a new key while any saved entry is malformed', async () => {
    await AsyncStorage.setItem(
      'baci.walletPay.openPurchases.v1',
      JSON.stringify({ p: { key: 'open-key' }, q: { key: 'k', at: 1 } })
    );
    walletPayPurchaseKeys.resetMemory();
    await expect(
      walletPayPurchaseKeys.keyFor('p', () => 'new')
    ).rejects.toThrow('unreadable');
  });
});
