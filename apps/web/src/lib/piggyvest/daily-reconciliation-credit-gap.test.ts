import { describe, expect, it, vi } from 'vitest';
import { runPiggyvestDailyReconciliation } from './daily-reconciliation-runtime';
import {
  env,
  executeWith,
  INTEGRATION,
  ledger,
  makeDeps,
  snapshot,
} from './daily-reconciliation-runtime.test-support';

vi.mock('server-only', () => ({}));

const CREDIT_ID = 'PVB01SYNTHETICCREDIT00000001';
const planWallet = (overrides: Record<string, unknown> = {}) => ({
  walletId: 'plan-wallet-a',
  inflow: [],
  inflowTruncated: false,
  interest: [],
  interestTruncated: false,
  unkeyed: 0,
  ...overrides,
});
const oneWalletLedger = (overrides: Record<string, unknown> = {}) =>
  ledger({ wallets: [planWallet(overrides)], walletsTotal: 1 });

function providerPage(ids: string[], category = 'bank-inflow') {
  return vi.fn(async () => ({
    status: true,
    data: {
      edges: ids.map((id) => ({
        id,
        amount: 250000,
        type: 'credit',
        status: 'successful',
        category,
        description: 'Synthetic',
        wallet_id: 'plan-wallet-a',
        wallet_type: 'api',
        created_at: '2026-11-01T12:00:00Z',
      })),
      pageInfo: { hasNextPage: false, endCursor: null, previousCursor: null },
    },
  }));
}

function depsWith(
  ledgerResult: unknown,
  listPage: ReturnType<typeof providerPage>,
  snapshotResult: unknown = snapshot()
) {
  const execute = executeWith(snapshotResult, ledgerResult);
  return makeDeps({
    createExecutor: vi.fn(() => execute) as never,
    createWalletPageReader: vi.fn(() => listPage),
  });
}

describe('daily reconciliation: credits PiggyVest made that we never recorded', () => {
  it('pages, and emails the PVB credit id, when a PiggyVest credit is missing from both ledgers', async () => {
    const { deps } = depsWith(oneWalletLedger(), providerPage([CREDIT_ID]));

    const result = await runPiggyvestDailyReconciliation({ env, deps });

    expect(result).toEqual({
      status: 'reported',
      report: 'attention',
      emailed: true,
      paged: true,
    });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      {
        reason: expect.stringContaining(
          'unrecorded_credits=1 not_on_provider=0 credit_unchecked=0'
        ),
      }
    );
    const email = vi.mocked(deps.sendEmail).mock.calls[0][0];
    expect(email.subject).toContain('NEEDS ATTENTION');
    expect(email.textContent).toContain(CREDIT_ID);
    expect(email.textContent).toContain('never recorded');
  });

  it('does not page when the PiggyVest credit matches a recorded pvb_reference', async () => {
    const { deps } = depsWith(
      oneWalletLedger({
        inflow: [{ reference: CREDIT_ID, at: '2026-11-01T12:00:00+00:00' }],
      }),
      providerPage([CREDIT_ID])
    );

    const result = await runPiggyvestDailyReconciliation({ env, deps });

    expect(result).toMatchObject({ report: 'clean', paged: false });
    expect(deps.emitAlert).not.toHaveBeenCalled();
  });

  it('still does not page for interest surplus alone (balance above recorded principal)', async () => {
    const { deps } = depsWith(
      oneWalletLedger({
        interest: [{ reference: CREDIT_ID, at: '2026-11-01T12:00:00+00:00' }],
      }),
      providerPage([CREDIT_ID], 'interest'),
      snapshot({
        wallets: [{ walletId: 'plan-wallet-a', expectedKobo: 1_000_000 }],
        walletsTotal: 1,
      })
    );
    deps.retrieveWallet = vi.fn(async (_config: unknown, id: string) => ({
      id,
      business_id: 'synthetic-business',
      balance: 1_250_000,
    })) as never;

    const result = await runPiggyvestDailyReconciliation({ env, deps });

    expect(result).toMatchObject({ report: 'clean', paged: false });
    expect(deps.emitAlert).not.toHaveBeenCalled();
    const email = vi.mocked(deps.sendEmail).mock.calls[0][0];
    expect(email.subject).toContain('REVIEW balances above record');
  });

  it('reads the ledger through the evidence executor with the rotation slot', async () => {
    const { deps } = depsWith(oneWalletLedger(), providerPage([]));
    await runPiggyvestDailyReconciliation({ env, deps });
    const execute = vi.mocked(deps.createExecutor).mock.results[0]
      .value as ReturnType<typeof executeWith>;
    expect(execute).toHaveBeenCalledWith(
      'SELECT piggyvest_primary.read_credit_gap_ledger($1::uuid,$2::text,$3::jsonb) AS result',
      [INTEGRATION, 'staging', JSON.stringify({ rotationSlot: 0 })]
    );
  });

  it('pages when the ledger read belongs to another business', async () => {
    const { deps } = depsWith(
      ledger({ businessId: 'other-business' }),
      providerPage([])
    );
    const result = await runPiggyvestDailyReconciliation({ env, deps });
    expect(result).toMatchObject({ report: 'attention', paged: true });
    expect(deps.emitAlert).toHaveBeenCalledWith(
      'PIGGYVEST_RECONCILIATION_MISMATCH',
      { reason: expect.stringContaining('credit_gap=failed:snapshot_invalid') }
    );
  });
});
