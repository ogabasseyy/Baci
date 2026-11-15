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
    // A possibly-paid sign in: the old account's payment may be moving (Muse).
    const maybePaid = {
      ...outcome('sign_in'),
      outcome: { kind: 'sign_in', maybePaid: true },
    };
    await expect(tracked.verifyPin(OP, '1234')).resolves.toEqual(maybePaid);
    await expect(tracked.pay(OP, 'proof')).resolves.toEqual(maybePaid);
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
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(
      new Error('disk busy')
    );
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).rejects.toThrow(
      'disk busy'
    );
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'a'
    );
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

describe('bugfix: a key that failed to save was still used (Codex P1)', () => {
  it('sends nothing until a new key is saved on the phone', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
      new Error('disk full')
    );
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'a')).rejects.toThrow(
      'disk full'
    );
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'b'
    );
    walletPayPurchaseKeys.resetMemory();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'c')).resolves.toBe(
      'b'
    );
  });
});

describe('bugfix: a settled key came back after a failed save (Codex P2)', () => {
  it('retries saving the removal', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
      new Error('disk busy')
    );
    await walletPayPurchaseKeys.forget('p');
    walletPayPurchaseKeys.resetMemory();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'b'
    );
  });
});

describe('bugfix: a mid-pay account switch dropped a delivered result (Muse)', () => {
  it('keeps the key when the account changed while the call was out', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    let owner = true;
    const opts = { onSettled: jest.fn(), stillOwner: () => owner };
    const switching = {
      start: jest.fn(),
      verifyPin: jest.fn(),
      pay: jest.fn(async () => {
        owner = false;
        return { kind: 'delivered', result: {} } as never;
      }),
    };
    await trackWalletPayPurchase(switching, 'p', opts).pay(OP, 'proof');
    expect(opts.onSettled).not.toHaveBeenCalled();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'a'
    );
  });

  it('still forgets the key when the same account gets the answer', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    const opts = options();
    await trackWalletPayPurchase(
      adapter({ kind: 'delivered', result: {} }),
      'p',
      opts
    ).pay(OP, 'proof');
    expect(opts.onSettled).toHaveBeenCalled();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'b'
    );
  });
});

describe('bugfix: unparseable saved keys were read as empty (Codex P1)', () => {
  const STORAGE_KEY = 'baci.walletPay.openPurchases.v1';
  afterEach(() => jest.restoreAllMocks());

  it('refuses to mint a new key while the saved data is unreadable', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{"p":{"key":"a","at":');
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).rejects.toThrow(
      'unreadable'
    );
    walletPayPurchaseKeys.resetMemory();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).rejects.toThrow(
      'unreadable'
    );
  });

  it('clears the unreadable data once every key in it has expired', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'not json');
    await expect(
      walletPayPurchaseKeys.keyFor('p', () => 'b')
    ).rejects.toThrow();
    const later = Date.now() + 8 * 24 * 60 * 60 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    walletPayPurchaseKeys.resetMemory();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'b'
    );
  });
});

describe('bugfix: a start closed mid-replay forgot its delivered key (Codex P1)', () => {
  it('keeps the key when the sheet no longer wants the answer', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'a');
    const opts = { ...options(), stillWanted: () => false };
    await trackWalletPayPurchase(
      adapter(null, { kind: 'delivered', result: {} }),
      'p',
      opts
    ).start();
    expect(opts.onSettled).not.toHaveBeenCalled();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'b')).resolves.toBe(
      'a'
    );
  });
});

describe('bugfix: a storage failure hid an already-delivered answer (Muse)', () => {
  it('still returns the delivered answer when forgetting the key fails', async () => {
    const forget = jest
      .spyOn(walletPayPurchaseKeys, 'forget')
      .mockRejectedValue(new Error('storage full'));
    const opts = options();
    const delivered = { kind: 'delivered', result: 'ok' };
    await expect(
      trackWalletPayPurchase(adapter(delivered), 'p', opts).pay(OP, 'proof')
    ).resolves.toEqual(delivered);
    expect(opts.onSettled).toHaveBeenCalledTimes(1);
    forget.mockRestore();
  });
});
