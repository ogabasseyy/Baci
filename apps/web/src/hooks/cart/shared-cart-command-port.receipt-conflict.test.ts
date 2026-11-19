// @vitest-environment node
import type { CartSnapshot } from '@baci/shared/cart';
import { expect, it, vi } from 'vitest';
import { createExperienceQueueObserver } from './experience-queue-observer';
import { createSharedCartCommandPort } from './shared-cart-command-port';
import type {
  SharedCartCommandRuntime,
  SharedCartExperienceEntry,
} from './shared-cart-experience-types';
import { createSharedCartReceiptStore } from './shared-cart-operation-receipts';

const snapshot: CartSnapshot = {
  cartId: 'cart',
  merchantId: 'merchant',
  state: 'active',
  version: 3,
  currency: 'NGN',
  subtotalMinor: 0,
  totalMinor: 0,
  estimatedTotals: false,
  expiresAt: '2030-01-01',
  lines: [],
};
const command = {
  kind: 'remove' as const,
  lineId: '10000000-0000-4000-8000-000000000001',
};
function fixture() {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  const entries = new Map<string, SharedCartExperienceEntry>();
  const runtime: SharedCartCommandRuntime = {
    enabled: () => true,
    generation: () => 1,
    read: () => snapshot,
    enqueue: vi.fn(),
    resolveProduct: async () => null,
    admit: () => ({ allowed: true }),
    loadContinuity: async () => 'shopper',
    entries,
    receiptStorage: storage,
  };
  return {
    entries,
    port: createSharedCartCommandPort(runtime),
    store: createSharedCartReceiptStore(storage),
    overwrite: (value: unknown) => {
      raw = JSON.stringify(value);
    },
  };
}
async function entryFor(f: ReturnType<typeof fixture>, id: string) {
  await vi.waitFor(() => expect(f.entries.has(id)).toBe(true));
  const entry = f.entries.get(id);
  if (!entry) throw Error('Missing queued operation');
  return entry;
}
it('cancels a conflicting reloaded operation, settles its SDK promise, and lets the next operation prepare', async () => {
  const f = fixture();
  const original = {
    operationId: 'reloaded',
    expectedVersion: 2,
    command: { type: 'remove' as const, lineId: command.lineId },
    partition: 'shopper',
    state: 'wire-attempted' as const,
  };
  f.store.put(original);
  const pending = f.port.submit(command, 'reloaded');
  const entry = await entryFor(f, 'reloaded');
  const dispatch = vi.fn();
  const observer = createExperienceQueueObserver(entry, {
    generation: 1,
    operationId: 'reloaded',
    isCurrent: () => true,
    dispatch,
  });
  expect(await observer.prepare(snapshot)).toBe(false);
  expect(dispatch).toHaveBeenLastCalledWith({
    type: 'command/cancel',
    generation: 1,
    operationId: 'reloaded',
  });
  await expect(pending).resolves.toMatchObject({
    status: 'error',
    code: 'IDEMPOTENCY_CONFLICT',
  });
  expect(f.store.get('shopper', 'reloaded')).toEqual(original);
  const next = f.port.submit(command, 'next');
  const nextEntry = await entryFor(f, 'next');
  expect(await nextEntry.prepare(snapshot)).toBe(true);
  nextEntry.finish({ ok: true, snapshot, replayed: false, warnings: [] });
  await expect(next).resolves.toMatchObject({ status: 'ok' });
});
it.each([
  false,
  true,
])('does not let a durable receipt conflict break settlement after attempted=%s', async (attempted) => {
  const f = fixture();
  const pending = f.port.submit(command, 'late-conflict');
  const entry = await entryFor(f, 'late-conflict');
  expect(await entry.prepare(snapshot)).toBe(true);
  const original = f.store.get('shopper', 'late-conflict');
  if (!original) throw Error('Missing prepared receipt');
  f.overwrite([{ ...original, expectedVersion: 2 }]);
  if (attempted) expect(() => entry.policy.onAttemptStart()).not.toThrow();
  expect(() => entry.deny()).not.toThrow();
  await expect(pending).resolves.toMatchObject(
    attempted
      ? { status: 'indeterminate', operationId: 'late-conflict' }
      : { status: 'error', code: 'CONNECTION_REVOKED' }
  );
  expect(f.store.get('shopper', 'late-conflict')?.expectedVersion).toBe(2);
});
