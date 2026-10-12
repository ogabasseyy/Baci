import { describe, expect, it, vi } from 'vitest';
import { readPiggyvestSavingsView } from './savings-view';
import { savingsViewFixture } from './savings-view.test-support';

vi.mock('server-only', () => ({}));

describe('server-owned savings view', () => {
  it('loads durable ledger amounts instead of making 95% or pending interest spendable', async () => {
    const fixture = savingsViewFixture();
    const execute = vi.fn(async () => ({ rows: [{ result: fixture.stored }] }));
    const result = await readPiggyvestSavingsView({
      configuration: fixture.configuration,
      resolveAuthenticatedGoal: async () => fixture.goal,
      execute,
    });
    expect(result).toMatchObject({
      status: 'ready',
      decision: {
        purchasingPowerKobo: 9500,
        readiness: 'continue_saving',
        purchaseAction: 'blocked',
      },
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT piggyvest_savings_ledger.snapshot($1::uuid,$2::uuid,$3::uuid,$4::uuid) AS result',
      Object.values(fixture.goal.identity)
    );
  });
  it('allows review, not an automatic purchase, after a genuine price reduction', async () => {
    const fixture = savingsViewFixture();
    fixture.goal.policy.currentOffer.priceKobo = 9000;
    const result = await readPiggyvestSavingsView({
      configuration: fixture.configuration,
      resolveAuthenticatedGoal: async () => fixture.goal,
      execute: async () => ({ rows: [{ result: fixture.stored }] }),
    });
    expect(result).toMatchObject({
      status: 'ready',
      decision: {
        readiness: 'ready_for_review',
        collectionAction: 'pause',
        purchaseAction: 'requires_customer_confirmation',
        surplusKobo: 500,
      },
    });
  });
  it.each([
    'customerId',
    'merchantId',
    'integrationId',
  ] as const)('rejects cross-scope %s before storage access', async (field) => {
    const fixture = savingsViewFixture();
    fixture.goal.identity[field] = '99999999-9999-4999-8999-999999999999';
    const execute = vi.fn();
    expect(
      await readPiggyvestSavingsView({
        configuration: fixture.configuration,
        resolveAuthenticatedGoal: async () => fixture.goal,
        execute,
      })
    ).toEqual({ status: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects client-provided ledger or clock fields before storage access', async () => {
    const fixture = savingsViewFixture();
    const execute = vi.fn();
    expect(
      await readPiggyvestSavingsView({
        configuration: fixture.configuration,
        resolveAuthenticatedGoal: async () => ({
          ...fixture.goal,
          policy: {
            ...fixture.goal.policy,
            ledger: fixture.stored.ledger,
            now: '2026-09-12T00:00:00Z',
          },
        }),
        execute,
      })
    ).toEqual({ status: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('returns no balance on failed authentication or storage', async () => {
    const fixture = savingsViewFixture();
    const execute = vi.fn();
    expect(
      await readPiggyvestSavingsView({
        configuration: fixture.configuration,
        resolveAuthenticatedGoal: async () => null,
        execute,
      })
    ).toEqual({ status: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
    expect(
      await readPiggyvestSavingsView({
        configuration: fixture.configuration,
        resolveAuthenticatedGoal: async () => fixture.goal,
        execute: async () => {
          throw new Error('synthetic-private-data');
        },
      })
    ).toEqual({ status: 'unavailable' });
  });
});
