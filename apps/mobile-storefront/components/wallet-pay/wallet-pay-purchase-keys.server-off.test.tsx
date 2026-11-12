import {
  trackWalletPayPurchase,
  walletPayPurchaseKeys,
} from './wallet-pay-purchase-keys';

const OP = '22222222-2222-4222-8222-222222222222';

beforeEach(() => walletPayPurchaseKeys.reset());

// Bookkeeping only: it calls no server, so it works the same either way.
describe('walletPayPurchaseKeys', () => {
  it('keeps one key per open purchase and mints a new one after it settles', () => {
    const mint = jest.fn().mockReturnValueOnce('a').mockReturnValueOnce('b');
    expect(walletPayPurchaseKeys.keyFor('p', mint)).toBe('a');
    expect(walletPayPurchaseKeys.keyFor('p', mint)).toBe('a');
    walletPayPurchaseKeys.forget('p');
    expect(walletPayPurchaseKeys.keyFor('p', mint)).toBe('b');
  });
});

describe('trackWalletPayPurchase', () => {
  const adapter = (payAnswer: unknown, startAnswer: unknown = null) => ({
    start: jest.fn(async () => startAnswer as never),
    verifyPin: jest.fn(),
    pay: jest.fn(async () => payAnswer as never),
  });

  it('keeps the key while PiggyVest is still confirming or reviewing', async () => {
    walletPayPurchaseKeys.keyFor('p', () => 'a');
    const onSettled = jest.fn();
    for (const kind of ['pending', 'review']) {
      const tracked = trackWalletPayPurchase(
        adapter({ kind: 'outcome', outcome: { kind } }),
        'p',
        onSettled
      );
      await tracked.pay(OP, '');
    }
    expect(onSettled).not.toHaveBeenCalled();
    expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).toBe('a');
  });

  it('forgets the key and reports when delivered, refunded or refused', async () => {
    const onSettled = jest.fn();
    walletPayPurchaseKeys.keyFor('p', () => 'a');
    await trackWalletPayPurchase(
      adapter({ kind: 'delivered', result: 'ok' }),
      'p',
      onSettled
    ).pay(OP, 'proof');
    expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).toBe('b');

    await trackWalletPayPurchase(
      adapter({ kind: 'outcome', outcome: { kind: 'refunded' } }),
      'p',
      onSettled
    ).pay(OP, '');
    await trackWalletPayPurchase(
      adapter(null, { kind: 'outcome', outcome: { kind: 'unavailable' } }),
      'p',
      onSettled
    ).start();
    expect(onSettled).toHaveBeenCalledTimes(3);
  });
});
