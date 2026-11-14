import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  trackWalletPayPurchase,
  walletPayPurchaseKeys,
} from './wallet-pay-purchase-keys';

beforeEach(async () => {
  await AsyncStorage.clear();
  walletPayPurchaseKeys.resetMemory();
});

const delivered = { kind: 'delivered', result: {} } as never;
const adapter = {
  start: jest.fn(async () => delivered),
  verifyPin: jest.fn(),
  pay: jest.fn(),
};

describe('bugfix: a late answer deleted a newer check’s key (Codex P1)', () => {
  it('forgets only the key that settled, never a newer one for the same purchase', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'newer');
    await walletPayPurchaseKeys.forget('p', 'older');
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'x')).resolves.toBe(
      'newer'
    );
    await walletPayPurchaseKeys.forget('p', 'newer');
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'x')).resolves.toBe(
      'x'
    );
  });

  it('a settled answer for an older key leaves the newer key in place', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'newer');
    await trackWalletPayPurchase(adapter, 'p', {
      onSettled: jest.fn(),
      stillOwner: () => true,
      key: () => 'older',
    }).start();
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'x')).resolves.toBe(
      'newer'
    );
  });
});

describe('bugfix: closing during retirement lost the key of a delivered check (Codex P2)', () => {
  it('puts the key back when the sheet closed before the answer was consumed', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'k');
    let wanted = true;
    // The sheet closes while the key is being retired.
    const stillWanted = jest.fn(() => wanted);
    const settling = walletPayPurchaseKeys.retire('p', 'k', stillWanted);
    wanted = false;
    await settling;
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'x')).resolves.toBe(
      'k'
    );
  });

  it('retires the key when the sheet still wants the answer', async () => {
    await walletPayPurchaseKeys.keyFor('p', () => 'k');
    await walletPayPurchaseKeys.retire('p', 'k', () => true);
    await expect(walletPayPurchaseKeys.keyFor('p', () => 'x')).resolves.toBe(
      'x'
    );
  });
});
