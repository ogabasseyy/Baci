import { expect, it, vi } from 'vitest';
import {
  isActiveOwnGoal,
  isCancellableOwnGoal,
  isCompletableOwnGoal,
} from './goal-pin-fund-eligibility';

function client(result: { data: unknown; error: unknown }) {
  const calls: [string, string, unknown][] = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      calls.push(['eq', column, value]);
      return builder;
    }),
    maybeSingle: vi.fn(async () => result),
  };
  const from = vi.fn(() => builder);
  return { supabase: { from } as never, from, builder, calls };
}
const ids = { merchantId: 'm', customerId: 'c', goalId: 'g' };

it('is true only for an active goal of this customer and merchant', async () => {
  const c = client({ data: { id: 'g' }, error: null });
  expect(await isActiveOwnGoal({ supabase: c.supabase, ...ids })).toBe(true);
  expect(c.from).toHaveBeenCalledWith('customer_savings_goals');
  expect(c.builder.select).toHaveBeenCalledWith('id');
  expect(c.calls).toEqual(
    expect.arrayContaining([
      ['eq', 'id', 'g'],
      ['eq', 'customer_id', 'c'],
      ['eq', 'merchant_id', 'm'],
      ['eq', 'status', 'active'],
    ])
  );
});
it('is false when no such goal is visible', async () => {
  const c = client({ data: null, error: null });
  expect(await isActiveOwnGoal({ supabase: c.supabase, ...ids })).toBe(false);
});
it('throws on a database error instead of passing', async () => {
  const c = client({ data: null, error: { message: 'x' } });
  await expect(
    isActiveOwnGoal({ supabase: c.supabase, ...ids })
  ).rejects.toThrow();
});

function cancelClient(result: { data: unknown; error: unknown }) {
  const calls: [string, string, unknown][] = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      calls.push(['eq', column, value]);
      return builder;
    }),
    in: vi.fn((column: string, value: unknown) => {
      calls.push(['in', column, value]);
      return builder;
    }),
    maybeSingle: vi.fn(async () => result),
  };
  return { supabase: { from: vi.fn(() => builder) } as never, calls };
}

it('a cancellable goal is an active or paused goal of this customer and merchant', async () => {
  const c = cancelClient({ data: { id: 'g' }, error: null });
  expect(await isCancellableOwnGoal({ supabase: c.supabase, ...ids })).toBe(
    true
  );
  expect(c.calls).toEqual(
    expect.arrayContaining([
      ['eq', 'id', 'g'],
      ['eq', 'customer_id', 'c'],
      ['eq', 'merchant_id', 'm'],
      ['in', 'status', ['active', 'paused']],
    ])
  );
});
it('a cancellable goal is false when none is visible and throws on error', async () => {
  const none = cancelClient({ data: null, error: null });
  expect(await isCancellableOwnGoal({ supabase: none.supabase, ...ids })).toBe(
    false
  );
  const bad = cancelClient({ data: null, error: { message: 'x' } });
  await expect(
    isCancellableOwnGoal({ supabase: bad.supabase, ...ids })
  ).rejects.toThrow();
});

it('a completable goal is an active, paused or completed goal of this customer and merchant', async () => {
  const c = cancelClient({ data: { id: 'g' }, error: null });
  expect(await isCompletableOwnGoal({ supabase: c.supabase, ...ids })).toBe(
    true
  );
  expect(c.calls).toEqual(
    expect.arrayContaining([
      ['eq', 'id', 'g'],
      ['eq', 'customer_id', 'c'],
      ['eq', 'merchant_id', 'm'],
      ['in', 'status', ['active', 'paused', 'completed']],
    ])
  );
});
it('a completable goal is false when none is visible and throws on error', async () => {
  const none = cancelClient({ data: null, error: null });
  expect(await isCompletableOwnGoal({ supabase: none.supabase, ...ids })).toBe(
    false
  );
  const bad = cancelClient({ data: null, error: { message: 'x' } });
  await expect(
    isCompletableOwnGoal({ supabase: bad.supabase, ...ids })
  ).rejects.toThrow();
});
