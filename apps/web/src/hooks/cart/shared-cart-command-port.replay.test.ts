// @vitest-environment node
import type { CartSnapshot } from '@baci/shared/cart';
import { expect, it, vi } from 'vitest';
import { createSharedCartCommandPort } from './shared-cart-command-port';
import type {
  SharedCartCommandRuntime,
  SharedCartExperienceEntry,
} from './shared-cart-experience-types';

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
async function replayFixture() {
  let raw: string | null = null;
  const entries = new Map<string, SharedCartExperienceEntry>();
  const runtime: SharedCartCommandRuntime = {
    enabled: () => true,
    generation: () => 1,
    read: () => snapshot,
    enqueue: vi.fn(),
    resolveProduct: async () => null,
    admit: () => ({ allowed: true }),
    loadContinuity: async () => 'shopper',
    refreshAdmission: async () => true,
    entries,
    receiptStorage: {
      getItem: () => raw,
      setItem: (_key, value) => {
        raw = value;
      },
    },
  };
  const port = createSharedCartCommandPort(runtime);
  const pending = port.submit(
    { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
    'replay'
  );
  await vi.waitFor(() => expect(entries.has('replay')).toBe(true));
  const original = entries.get('replay');
  if (!original) throw Error('missing original operation');
  expect(await original.prepare(snapshot)).toBe(true);
  original.policy.onAttemptStart?.();
  original.deny();
  expect(await pending).toMatchObject({ status: 'indeterminate' });
  entries.clear();
  return { runtime, port, entries, receipt: () => JSON.parse(raw ?? '[]')[0] };
}
it.each([
  'missing-continuity',
  'denied-admission',
  'failed-refresh',
  'late-admission',
] as const)('retains replayability after %s during replay preparation', async (failure) => {
  const f = await replayFixture();
  const pending = f.port.reconcile('replay');
  await vi.waitFor(() => expect(f.entries.has('replay')).toBe(true));
  const entry = f.entries.get('replay');
  if (!entry) throw Error('missing replay');
  if (failure === 'missing-continuity')
    f.runtime.loadContinuity = async () => null;
  if (failure === 'denied-admission')
    f.runtime.admit = () => ({ allowed: false, code: 'CONNECTION_REVOKED' });
  if (failure === 'failed-refresh')
    f.runtime.refreshAdmission = async () => false;
  if (failure === 'late-admission')
    f.runtime.loadContinuity = async () => {
      f.runtime.admit = () => ({ allowed: false, code: 'CONNECTION_REVOKED' });
      return 'shopper';
    };
  expect(await entry.prepare(snapshot)).toBe(false);
  expect(entry.isSettled()).toBe(true);
  entry.deny();
  expect(await pending).toEqual({
    status: 'indeterminate',
    operationId: 'replay',
  });
  expect(f.receipt().state).toBe('indeterminate');
});
it('keeps the previous wire attempt durable while replay preparation completes', async () => {
  const f = await replayFixture();
  const pending = f.port.reconcile('replay');
  await vi.waitFor(() => expect(f.entries.has('replay')).toBe(true));
  const entry = f.entries.get('replay');
  if (!entry) throw Error('missing replay');
  expect(await entry.prepare(snapshot)).toBe(true);
  expect(f.receipt().state).toBe('indeterminate');
  entry.finish({
    ok: false,
    code: 'invalid_item',
    snapshot: null,
    retryable: false,
    admissionDenied: true,
    attempted: false,
    priorOutcome: 'none',
    denialCode: 'CONNECTION_REVOKED',
  });
  expect(await pending).toEqual({
    status: 'indeterminate',
    operationId: 'replay',
  });
  expect(f.receipt().state).toBe('indeterminate');
});
it('keeps a freshly CSRF-rejected operation definitively unsent', async () => {
  const f = await replayFixture();
  const pending = f.port.submit(
    { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
    'csrf-rejected'
  );
  await vi.waitFor(() => expect(f.entries.has('csrf-rejected')).toBe(true));
  const entry = f.entries.get('csrf-rejected');
  if (!entry) throw Error('missing operation');
  expect(await entry.prepare(snapshot)).toBe(true);
  entry.policy.onAttemptStart();
  entry.finish({
    ok: false,
    code: 'unauthorized',
    snapshot: null,
    retryable: false,
    admissionDenied: true,
    denialCode: 'CONNECTION_REVOKED',
    attempted: true,
    priorOutcome: 'csrf-rejected',
  });
  expect(await pending).toMatchObject({
    status: 'error',
    code: 'CONNECTION_REVOKED',
  });
});

it.each([
  'conflict',
  'ok',
] as const)('recovers a settled %s without receipt storage and without resending', async (status) => {
  const f = await replayFixture();
  f.runtime.receiptStorage = null;
  const port = createSharedCartCommandPort(f.runtime);
  const pending = port.submit(
    { kind: 'remove', lineId: '10000000-0000-4000-8000-000000000001' },
    'late'
  );
  await vi.waitFor(() => expect(f.entries.has('late')).toBe(true));
  const entry = f.entries.get('late');
  if (!entry) throw Error('missing operation');
  expect(await entry.prepare(snapshot)).toBe(true);
  entry.policy.onAttemptStart();
  entry.finish(
    status === 'ok'
      ? { ok: true, snapshot, replayed: false, warnings: [] }
      : { ok: false, code: 'version_conflict', snapshot, retryable: false }
  );
  const expected = await pending;
  expect(expected.status).toBe(status);
  expect(await port.reconcile('late')).toEqual(expected);
  expect(f.runtime.enqueue).toHaveBeenCalledTimes(2);

  f.runtime.loadContinuity = async () => 'different-shopper';
  expect(await port.reconcile('late')).toEqual({
    status: 'indeterminate',
    operationId: 'late',
  });

  f.runtime.loadContinuity = async () => 'shopper';
  f.runtime.refreshAdmission = async () => false;
  expect(await port.reconcile('late')).toMatchObject({
    status: 'error',
    code: 'CONNECTION_REVOKED',
  });
});
