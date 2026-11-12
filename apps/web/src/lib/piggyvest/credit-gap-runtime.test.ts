import { describe, expect, it, vi } from 'vitest';
import { buildCreditGapPorts } from './credit-gap-runtime';

vi.mock('server-only', () => ({}));

const INTEGRATION = '00000000-0000-4000-8000-000000000001';

function ledger(businessId = 'synthetic-business') {
  return {
    generatedAt: '2026-11-11T23:00:00.000Z',
    windowStart: '2026-11-08T23:00:00.000Z',
    businessId,
    wallets: [],
    walletsTotal: 0,
    walletsDeferred: 0,
  };
}

function build(
  execute: (
    statement: string,
    parameters: readonly string[]
  ) => Promise<{ rows: unknown }>,
  overrides: { listPage?: () => Promise<unknown>; expired?: () => boolean } = {}
) {
  return buildCreditGapPorts({
    execute,
    integrationId: INTEGRATION,
    environment: 'staging',
    businessId: 'synthetic-business',
    rotationSlot: 20403,
    listPage: overrides.listPage ?? (async () => ({})),
    expired: overrides.expired ?? (() => false),
  });
}

describe('buildCreditGapPorts', () => {
  it('reads the ledger through the evidence function with the rotation slot', async () => {
    const execute = vi.fn(async () => ({ rows: [{ result: ledger() }] }));

    const loaded = await build(execute).loadLedger();

    expect(loaded).toEqual(ledger());
    expect(execute).toHaveBeenCalledWith(
      'SELECT piggyvest_primary.read_credit_gap_ledger($1::uuid,$2::text,$3::jsonb) AS result',
      [INTEGRATION, 'staging', '{"rotationSlot":20403}']
    );
  });

  it('rejects a ledger read for another business', async () => {
    const execute = vi.fn(async () => ({
      rows: [{ result: ledger('other-business') }],
    }));
    expect(await build(execute).loadLedger()).toEqual({ rejected: true });
  });

  it('rejects a malformed ledger result', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    expect(await build(execute).loadLedger()).toEqual({ rejected: true });
  });

  it('passes a database error on to the check', async () => {
    const execute = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(build(execute).loadLedger()).rejects.toThrow('down');
  });

  it('stops listing pages once the shared budget is spent', async () => {
    const listPage = vi.fn(async () => ({}));
    const ports = build(
      vi.fn(async () => ({ rows: [] })),
      { listPage, expired: () => true }
    );

    const listing = await ports.listWalletCredits('plan-wallet-a', 0);

    expect(listing).toEqual({ outcome: 'incomplete', reason: 'deadline' });
    expect(listPage).not.toHaveBeenCalled();
    expect(ports.expired()).toBe(true);
  });
});
