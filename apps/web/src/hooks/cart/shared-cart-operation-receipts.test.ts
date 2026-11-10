// @vitest-environment node
import { expect, it } from 'vitest';
import { createSharedCartReceiptStore } from './shared-cart-operation-receipts';

it('persists bounded original envelopes only in exact continuity partitions', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const store = createSharedCartReceiptStore(storage);
  const receipt = {
    operationId: 'op',
    expectedVersion: 1,
    command: {
      type: 'add' as const,
      item: { productId: 'p', condition: 'used' as const },
      quantity: 1,
    },
    partition: 'fingerprint-a',
    state: 'wire-attempted' as const,
  };
  expect(store.put(receipt)).toBe(true);
  expect(store.get('fingerprint-a', 'op')).toEqual(receipt);
  expect(store.get('fingerprint-b', 'op')).toBeNull();
  expect(() =>
    store.put({ ...receipt, command: { ...receipt.command, quantity: 2 } })
  ).toThrow('IDEMPOTENCY_CONFLICT');
  expect(store.put({ ...receipt, state: 'confirmed' })).toBe(true);
});
it('storage failure disables durable reload replay without pretending persistence', () => {
  const store = createSharedCartReceiptStore({
    getItem: () => null,
    setItem: () => {
      throw Error('quota');
    },
  });
  expect(
    store.put({
      operationId: 'op',
      expectedVersion: 1,
      command: { type: 'remove', lineId: 'synthetic-line' },
      partition: 'p',
      state: 'wire-attempted',
    })
  ).toBe(false);
  expect(store.get('p', 'op')).toBeNull();
});
it('does not reload private voucher or negotiated-price fields from tampered storage', () => {
  const raw = JSON.stringify([
    {
      operationId: 'op',
      expectedVersion: 1,
      partition: 'p',
      state: 'indeterminate',
      command: {
        type: 'add',
        item: { productId: 'p' },
        quantity: 1,
        voucherToken: 'private',
      },
    },
  ]);
  expect(
    createSharedCartReceiptStore({ getItem: () => raw, setItem: () => {} }).get(
      'p',
      'op'
    )
  ).toBeNull();
});

it('hashes the immutable original envelope independent of option insertion order', async () => {
  const { hashCartOperation } = await import(
    './shared-cart-operation-receipts'
  );
  const first = {
    operationId: 'original',
    expectedVersion: 2,
    partition: 'p',
    command: {
      type: 'add' as const,
      item: { productId: 'product', options: { Color: 'Blue', Size: '128GB' } },
      quantity: 1,
    },
  };
  const hash = await hashCartOperation(first);
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(
    await hashCartOperation({
      ...first,
      command: {
        ...first.command,
        item: {
          ...first.command.item,
          options: { Size: '128GB', Color: 'Blue' },
        },
      },
    })
  ).toBe(hash);
  expect(await hashCartOperation({ ...first, expectedVersion: 3 })).not.toBe(
    hash
  );
});
