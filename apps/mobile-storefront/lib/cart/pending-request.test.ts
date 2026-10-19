import * as SecureStore from 'expo-secure-store';
import { pendingCartRequest } from './pending-request';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
const secure = jest.mocked(SecureStore);
const merchant = '11111111-1111-4111-8111-111111111111';
const request = {
  actor: 'guest-principal',
  operationId: 'operation-1',
  body: { operationId: 'operation-1', lines: [{ name: '充電器'.repeat(800) }] },
};
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  secure.getItemAsync.mockImplementation(
    async (key) => values.get(key) ?? null
  );
  secure.setItemAsync.mockImplementation(async (key, value) => {
    values.set(key, value);
  });
  secure.deleteItemAsync.mockImplementation(async (key) => {
    values.delete(key);
  });
});
it('persists one complete request in bounded secure chunks and merchant namespaces', async () => {
  await pendingCartRequest.save(merchant, request);
  expect(
    Math.max(...[...values.values()].map((value) => value.length))
  ).toBeLessThanOrEqual(1200);
  expect(await pendingCartRequest.read(merchant)).toEqual(request);
  expect(
    await pendingCartRequest.read('22222222-2222-4222-8222-222222222222')
  ).toBeNull();
});
it('does not expose a partially written request after a secure write fails', async () => {
  secure.setItemAsync
    .mockImplementationOnce(async (key, value) => {
      values.set(key, value);
    })
    .mockRejectedValueOnce(new Error('write failed'));
  await expect(pendingCartRequest.save(merchant, request)).rejects.toThrow();
  expect(await pendingCartRequest.read(merchant)).toBeNull();
});
it('refuses to overwrite unresolved intent and fences late acknowledgements', async () => {
  await pendingCartRequest.save(merchant, request);
  await expect(
    pendingCartRequest.save(merchant, { ...request, operationId: 'different' })
  ).rejects.toThrow();
  await pendingCartRequest.clear(merchant, 'different');
  expect(await pendingCartRequest.read(merchant)).toEqual(request);
  await pendingCartRequest.clear(merchant, request.operationId);
  expect(await pendingCartRequest.read(merchant)).toBeNull();
});
it('propagates secure read outages instead of inventing an empty receipt', async () => {
  secure.getItemAsync.mockRejectedValueOnce(
    new Error('private storage detail')
  );
  await expect(pendingCartRequest.read(merchant)).rejects.toThrow(
    'Cart request storage unavailable'
  );
});
