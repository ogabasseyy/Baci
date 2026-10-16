import * as SecureStore from 'expo-secure-store';
import { cartSessionStorage } from './session-storage';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const secure = jest.mocked(SecureStore);
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  jest.clearAllMocks();
  secure.getItemAsync.mockResolvedValue(null);
  secure.setItemAsync.mockResolvedValue();
  secure.deleteItemAsync.mockResolvedValue();
});
it('keeps merchants in separate secure namespaces without using customer Auth keys', async () => {
  await cartSessionStorage.set(a, 'cp1.a.signature');
  await cartSessionStorage.set(b, 'cp1.b.signature');
  const keys = secure.setItemAsync.mock.calls.map((call) => call[0]);
  expect(new Set(keys).size).toBe(2);
  expect(keys[0]).toContain(a);
  expect(keys[1]).toContain(b);
  expect(keys.every((key) => key.startsWith('baci.cart.session.'))).toBe(true);
});
it('treats a corrupted stored record as absent and overwrites it on set', async () => {
  secure.getItemAsync.mockResolvedValue('{"proof":123,schema-drift');
  await expect(cartSessionStorage.get(a)).resolves.toBeNull();
  await cartSessionStorage.set(a, 'cp1.fresh.signature');
  expect(secure.setItemAsync).toHaveBeenCalledWith(
    expect.stringContaining(a),
    expect.stringContaining('cp1.fresh.signature')
  );
  secure.getItemAsync.mockResolvedValue('{"unexpected":"shape"}');
  await expect(cartSessionStorage.get(a)).resolves.toBeNull();
});

it('does not interpret secure storage outages as a missing cart', async () => {
  secure.getItemAsync.mockRejectedValue(new Error('private native detail'));
  await expect(cartSessionStorage.get(a)).rejects.toThrow(
    'Cart session storage unavailable'
  );
});
it('normalizes UUID case and removes only the selected merchant', async () => {
  await cartSessionStorage.set(a.toUpperCase(), 'cp1.a.signature');
  await cartSessionStorage.remove(a);
  expect(secure.deleteItemAsync).toHaveBeenCalledWith(
    secure.setItemAsync.mock.calls[0][0]
  );
});
it('serializes logout removal after a pending proof write', async () => {
  let finish: () => void = () => {};
  let started: () => void = () => {};
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  secure.setItemAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
        started();
      })
  );
  const write = cartSessionStorage.set(a, 'cp1.a.signature');
  await writing;
  const remove = cartSessionStorage.remove(a);
  expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  finish();
  await write;
  await remove;
  expect(secure.deleteItemAsync).toHaveBeenCalledTimes(1);
});
it('rejects unsafe merchant keys before touching storage', async () => {
  await expect(cartSessionStorage.get('../other-account')).rejects.toThrow(
    'Invalid cart merchant'
  );
  expect(secure.getItemAsync).not.toHaveBeenCalled();
});
it('atomically persists creation recovery metadata with the promoted proof', async () => {
  const receipt = {
    operationId: 'create-one',
    cartId: b,
    kind: 'create' as const,
  };
  let stored: string | null = null;
  secure.setItemAsync.mockImplementation(async (_key, value) => {
    stored = value;
  });
  secure.getItemAsync.mockImplementation(async () => stored);
  await cartSessionStorage.set(a, 'cp1.a.signature', receipt);
  expect(await cartSessionStorage.get(a)).toBe('cp1.a.signature');
  expect(await cartSessionStorage.getPromotionReceipt?.(a)).toEqual(receipt);
  expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
});
it('retires a proof atomically so restarts cannot restore it, and fences late proof writes', async () => {
  let stored: string | null = null;
  secure.setItemAsync.mockImplementation(async (_key, value) => {
    stored = value;
  });
  secure.getItemAsync.mockImplementation(async () => stored);
  await cartSessionStorage.set(a, 'cp1.a.signature');
  await cartSessionStorage.retire?.(a);
  expect(await cartSessionStorage.get(a)).toBeNull();
  expect(await cartSessionStorage.getRetiredProof?.(a)).toBe('cp1.a.signature');
  await expect(
    cartSessionStorage.set(a, 'cp1.late.signature')
  ).rejects.toThrow();
  expect(await cartSessionStorage.getRetiredProof?.(a)).toBe('cp1.a.signature');
  await cartSessionStorage.acknowledgeRetirement?.(a, 'cp1.wrong.signature');
  expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  await cartSessionStorage.acknowledgeRetirement?.(a, 'cp1.a.signature');
  expect(secure.deleteItemAsync).toHaveBeenCalledTimes(1);
});
it('retains account ownership when ordinary command replies renew the proof', async () => {
  let stored: string | null = null;
  secure.setItemAsync.mockImplementation(async (_key, value) => {
    stored = value;
  });
  secure.getItemAsync.mockImplementation(async () => stored);
  const ownerSubject = '44444444-4444-4444-8444-444444444444';
  await cartSessionStorage.set(a, 'cp1.account.signature', {
    kind: 'account',
    operationId: 'link',
    cartId: b,
    ownerSubject,
    fromActor: 'guest-one',
  });
  await cartSessionStorage.set(a, 'cp1.renewed.signature');
  expect(await cartSessionStorage.getOwnerSubject?.(a)).toBe(ownerSubject);
});
