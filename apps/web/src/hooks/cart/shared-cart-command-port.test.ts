// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createSharedCartCommandPort } from './shared-cart-command-port';

it('rejects disabled enrollment and injected amounts before queue/provisioning', async () => {
  const enqueue = vi.fn();
  const port = createSharedCartCommandPort({
    enabled: () => false,
    enqueue,
    read: () => null,
    resolveProduct: vi.fn(),
    admit: () => ({ allowed: true }),
    loadContinuity: vi.fn(),
    generation: () => 1,
    entries: new Map(),
    receiptStorage: null,
  });
  expect(
    await port.submit(
      {
        kind: 'add',
        productId: '10000000-0000-4000-8000-000000000001',
        quantity: 1,
      },
      'op'
    )
  ).toMatchObject({ code: 'CART_ENROLLMENT_REQUIRED' });
  expect(enqueue).not.toHaveBeenCalled();
});
it('rebinds only after fresh server continuity and submits an immutable original envelope through the queue', async () => {
  const entries = new Map();
  let queued = '';
  const snapshot = {
    cartId: 'cart',
    merchantId: 'm',
    state: 'active' as const,
    version: 3,
    currency: 'NGN',
    subtotalMinor: 0,
    totalMinor: 0,
    estimatedTotals: false,
    expiresAt: '2030-01-01',
    lines: [],
  };
  const rebind = vi.fn(() => true);
  const id = '10000000-0000-4000-8000-000000000001';
  const port = createSharedCartCommandPort({
    enabled: () => true,
    enqueue: (op) => {
      queued = op;
    },
    read: () => snapshot,
    resolveProduct: async () =>
      ({ id, name: 'Synthetic', price: 100 }) as never,
    admit: () => ({ allowed: true }),
    loadContinuity: async () => 'verified-fingerprint',
    rebind,
    generation: () => 1,
    entries,
    receiptStorage: null,
  });
  const result = port.submit(
    { kind: 'add', productId: id, condition: 'refurbished', quantity: 1 },
    'same-operation'
  );
  await Promise.resolve();
  await Promise.resolve();
  const entry = entries.get('same-operation');
  expect(queued).toBe('same-operation');
  expect(rebind).not.toHaveBeenCalled();
  expect(await entry.prepare(snapshot)).toBe(true);
  expect(rebind).toHaveBeenCalledWith('verified-fingerprint');
  expect(entry.envelope).toEqual({
    operationId: 'same-operation',
    expectedVersion: 3,
    command: {
      type: 'add',
      item: { productId: id, condition: 'refurbished' },
      quantity: 1,
    },
  });
  entry.finish({ ok: true, snapshot, replayed: false, warnings: [] });
  expect(await result).toMatchObject({ status: 'ok' });
});
it('records a late confirmed receipt but withholds its cart when the shopper changed', async () => {
  const entries = new Map();
  let same = true;
  let raw: string | null = null;
  const snapshot = {
    version: 2,
    currency: 'NGN',
    totalMinor: 10000,
    lines: [],
  };
  const port = createSharedCartCommandPort({
    enabled: () => true,
    generation: () => 1,
    entries,
    read: () => snapshot as never,
    resolveProduct: async () => null,
    enqueue: () => {},
    admit: () => ({ allowed: true }),
    loadContinuity: async () => 'guest-fingerprint',
    sameShopper: () => same,
    receiptStorage: {
      getItem: () => raw,
      setItem: (_key, value) => {
        raw = value;
      },
    },
  });
  const pending = port.submit(
    { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
    'late-operation'
  );
  await Promise.resolve();
  const entry = entries.get('late-operation');
  await entry.prepare(snapshot);
  entry.policy.onAttemptStart();
  same = false;
  entry.finish({ ok: true, snapshot, replayed: false, warnings: [] });
  expect(await pending).toEqual({
    status: 'indeterminate',
    operationId: 'late-operation',
  });
  expect(JSON.parse(raw ?? '[]')[0].state).toBe('confirmed');
});
it('reconciles an in-flight operation with its existing promise, without a second queue entry', async () => {
  const entries = new Map();
  const enqueue = vi.fn();
  const continuity = vi.fn(async () => 'shopper');
  const snapshot = { version: 3, currency: 'NGN', totalMinor: 0, lines: [] };
  const port = createSharedCartCommandPort({
    enabled: () => true,
    generation: () => 1,
    entries,
    enqueue,
    read: () => snapshot as never,
    resolveProduct: async () => null,
    admit: () => ({ allowed: true }),
    loadContinuity: continuity,
    receiptStorage: null,
  });
  const original = port.submit(
    { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
    'pending'
  );
  const entry = entries.get('pending');
  entry.started = true;
  const replay = port.reconcile('pending');
  await Promise.resolve();
  expect(continuity).not.toHaveBeenCalled();
  entry.finish({ ok: true, snapshot, replayed: false, warnings: [] });
  expect(await replay).toEqual(await original);
  expect(enqueue).toHaveBeenCalledTimes(1);
});
it('coalesces the same operation across host ports before product resolution completes', async () => {
  const entries = new Map();
  const enqueue = vi.fn();
  let resolve: (v: never) => void = () => {};
  const product = new Promise<never>((r) => {
    resolve = r;
  });
  const deps = {
    enabled: () => true,
    generation: () => 1,
    entries,
    enqueue,
    read: () => null,
    resolveProduct: () => product,
    admit: () => ({ allowed: true as const }),
    loadContinuity: async () => null,
    receiptStorage: null,
  };
  const command = {
    kind: 'add' as const,
    productId: '10000000-0000-4000-8000-000000000001',
    quantity: 1,
  };
  const first = createSharedCartCommandPort(deps).submit(command, 'same');
  const second = createSharedCartCommandPort(deps).submit(command, 'same');
  resolve({ id: command.productId, name: 'Synthetic', price: 1 } as never);
  await Promise.resolve();
  await Promise.resolve();
  expect(enqueue).toHaveBeenCalledTimes(1);
  entries.get('same').deny();
  expect(await first).toEqual(await second);
});

it('admits more than 64 completed operations without evicting an in-flight observer', async () => {
  const entries = new Map();
  const pending = { isSettled: () => false };
  entries.set('in-flight', pending);
  const snapshot = { version: 1, currency: 'NGN', totalMinor: 0, lines: [] };
  const port = createSharedCartCommandPort({
    enabled: () => true,
    generation: () => 1,
    entries,
    read: () => snapshot as never,
    resolveProduct: async () => null,
    enqueue: (id) =>
      queueMicrotask(() =>
        entries
          .get(id)
          .finish({ ok: true, snapshot, replayed: false, warnings: [] })
      ),
    admit: () => ({ allowed: true }),
    loadContinuity: async () => 'shopper',
    receiptStorage: null,
  });
  for (let i = 0; i < 80; i++)
    expect(
      await port.submit(
        { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
        `settled-${i}`
      )
    ).toMatchObject({ status: 'ok' });
  expect(entries.size).toBeLessThanOrEqual(64);
  expect(entries.get('in-flight')).toBe(pending);
});

it('keeps the quota when every retained observer is still in flight', async () => {
  const entries = new Map(
    Array.from({ length: 64 }, (_, i) => [
      `pending-${i}`,
      { isSettled: () => false },
    ])
  );
  const enqueue = vi.fn();
  const port = createSharedCartCommandPort({
    enabled: () => true,
    generation: () => 1,
    entries: entries as never,
    read: () => null,
    resolveProduct: async () => null,
    enqueue,
    admit: () => ({ allowed: true }),
    loadContinuity: async () => 'shopper',
    receiptStorage: null,
  });
  expect(
    await port.submit(
      { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
      'next'
    )
  ).toMatchObject({ code: 'QUOTA_EXCEEDED' });
  expect(entries.size).toBe(64);
  expect(enqueue).not.toHaveBeenCalled();
});
