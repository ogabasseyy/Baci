import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  trackWalletPayPurchase,
  walletPayPurchaseKeys,
} from './wallet-pay-purchase-keys';

const OP = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
});

const options = (stillOwner = true) => ({
  onSettled: jest.fn(),
  stillOwner: () => stillOwner,
});
const adapter = (payAnswer: unknown, startAnswer: unknown = null) => ({
  start: jest.fn(async () => startAnswer as never),
  verifyPin: jest.fn(),
  pay: jest.fn(async () => payAnswer as never),
});
const outcome = (kind: string) => ({ kind: 'outcome', outcome: { kind } });

// Bookkeeping only: it calls no server itself, so it works the same either way.
describe('walletPayPurchaseKeys', () => {
  it('keeps one key per open purchase, across a restart, until it settles', async () => {
    const mint = jest.fn().mockReturnValueOnce('a').mockReturnValueOnce('b');
    await expect(walletPayPurchaseKeys.keyFor('p', mint)).resolves.toBe('a');
    walletPayPurchaseKeys.resetMemory();
    await expect(walletPayPurchaseKeys.keyFor('p', mint)).resolves.toBe('a');
    await walletPayPurchaseKeys.forget('p');
    walletPayPurchaseKeys.resetMemory();
    await expect(walletPayPurchaseKeys.keyFor('p', mint)).resolves.toBe('b');
  });

  it('bugfix: two quick taps on a cold start get the same key (Codex P1)', async () => {
    let n = 0;
    const mint = () => {
      n += 1;
      return `key-${n}`;
    };
    const [first, second] = await Promise.all([
      walletPayPurchaseKeys.keyFor('p', mint),
      walletPayPurchaseKeys.keyFor('p', mint),
    ]);
    expect(first).toBe('key-1');
    expect(second).toBe('key-1');
    walletPayPurchaseKeys.resetMemory();
    await expect(walletPayPurchaseKeys.keyFor('p', mint)).resolves.toBe(
      'key-1'
    );
  });
});

describe('trackWalletPayPurchase', () => {
  it('keeps the key while PiggyVest is still confirming or reviewing', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    const opts = options();
    for (const kind of ['pending', 'review'])
      await trackWalletPayPurchase(adapter(outcome(kind)), 'p', opts).pay(
        OP,
        ''
      );
    expect(opts.onSettled).not.toHaveBeenCalled();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'a'
    );
  });

  it('bugfix: a lost session or pause after a PIN keeps the key (Codex P1)', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    const opts = options();
    for (const kind of ['sign_in', 'unavailable', 'failed'])
      await trackWalletPayPurchase(adapter(outcome(kind)), 'p', opts).pay(
        OP,
        ''
      );
    await trackWalletPayPurchase(
      adapter(null, outcome('sign_in')),
      'p',
      opts
    ).start();
    expect(opts.onSettled).not.toHaveBeenCalled();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'a'
    );
  });

  it('forgets the key and reports when delivered, refunded or refused before paying', async () => {
    const opts = options();
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    await trackWalletPayPurchase(
      adapter({ kind: 'delivered', result: 'ok' }),
      'p',
      opts
    ).pay(OP, 'proof');
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'b'
    );
    await trackWalletPayPurchase(adapter(outcome('refunded')), 'p', opts).pay(
      OP,
      ''
    );
    await trackWalletPayPurchase(
      adapter(null, outcome('insufficient')),
      'p',
      opts
    ).start();
    expect(opts.onSettled).toHaveBeenCalledTimes(3);
  });

  it('bugfix: sends nothing once the signed-in account changed (Codex P1)', async () => {
    const inner = adapter({ kind: 'delivered', result: 'ok' });
    const tracked = trackWalletPayPurchase(inner, 'p', options(false));
    await expect(tracked.verifyPin(OP, '1234')).resolves.toEqual(
      outcome('sign_in')
    );
    await expect(tracked.pay(OP, 'proof')).resolves.toEqual(outcome('sign_in'));
    expect(inner.verifyPin).not.toHaveBeenCalled();
    expect(inner.pay).not.toHaveBeenCalled();
  });

  it('bugfix: a refusal before the transfer frees the key (Muse)', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    const opts = options();
    await trackWalletPayPurchase(adapter(outcome('failed')), 'p', opts).pay(
      OP,
      'proof'
    );
    expect(opts.onSettled).toHaveBeenCalledTimes(1);
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'b'
    );
  });
});

describe('bugfix: unreadable saved keys minted a second key (Codex P1)', () => {
  it('refuses to hand out a key until the saved keys can be read', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    walletPayPurchaseKeys.resetMemory();
    const getItem = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValueOnce(new Error('disk busy'));
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).rejects.toThrow(
      'disk busy'
    );
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'a'
    );
    getItem.mockRestore();
  });

  it('settles a purchase whose replayed start was already delivered', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    const opts = options();
    await trackWalletPayPurchase(
      adapter(null, { kind: 'delivered', result: 'ok' }),
      () => 'p',
      opts
    ).start();
    expect(opts.onSettled).toHaveBeenCalledTimes(1);
  });
});
