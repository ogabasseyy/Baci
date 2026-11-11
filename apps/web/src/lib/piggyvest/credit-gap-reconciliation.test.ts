import { describe, expect, it, vi } from 'vitest';
import type { ProviderCreditListing } from './credit-gap-provider-reader';
import {
  type CreditGapPorts,
  compareWalletCredits,
  creditGapPages,
  runCreditGapCheck,
} from './credit-gap-reconciliation';

const GENERATED = '2026-11-11T23:00:00.000Z';
const WINDOW_START = '2026-11-08T23:00:00.000Z';
const window = {
  startMs: Date.parse(WINDOW_START),
  generatedMs: Date.parse(GENERATED),
};

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    walletId: 'plan-wallet-a',
    inflow: [],
    inflowTruncated: false,
    interest: [],
    interestTruncated: false,
    unkeyed: 0,
    ...overrides,
  };
}

function credit(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    category: 'bank-inflow',
    status: 'successful' as const,
    amountKobo: 250000,
    createdAt: '2026-11-10T12:00:00.000Z',
    ...overrides,
  };
}

function ledger(wallets: unknown[]) {
  return {
    generatedAt: GENERATED,
    windowStart: WINDOW_START,
    businessId: 'synthetic-business',
    wallets,
    walletsTotal: wallets.length,
    walletsDeferred: 0,
  };
}

function ports(
  loaded: unknown,
  listing: ProviderCreditListing = { outcome: 'complete', credits: [] }
): CreditGapPorts {
  return {
    loadLedger: vi.fn(async () => loaded),
    listWalletCredits: vi.fn(async () => listing),
    expired: () => false,
  };
}

describe('credit-gap check', () => {
  it('pages for a PiggyVest credit our ledgers never recorded', async () => {
    const report = await runCreditGapCheck(
      ports(ledger([wallet()]), {
        outcome: 'complete',
        credits: [credit('PVB01MISSINGCREDIT0000000001')],
      })
    );

    expect(report).toMatchObject({
      status: 'checked',
      walletsChecked: 1,
      findings: [
        {
          walletId: 'plan-wallet-a',
          reference: 'PVB01MISSINGCREDIT0000000001',
          kind: 'unrecorded_credit',
          amountKobo: 250000,
        },
      ],
    });
    expect(creditGapPages(report)).toBe(true);
  });

  it('does not page when every PiggyVest credit matches a recorded pvb_reference', async () => {
    const recorded = {
      reference: 'PVB01MATCHED0000000000000001',
      at: '2026-11-10T12:00:00.000Z',
    };
    const report = await runCreditGapCheck(
      ports(ledger([wallet({ inflow: [recorded] })]), {
        outcome: 'complete',
        credits: [credit('PVB01MATCHED0000000000000001')],
      })
    );

    expect(report).toMatchObject({
      status: 'checked',
      findings: [],
      unchecked: [],
    });
    expect(creditGapPages(report)).toBe(false);
  });

  it('matches an interest payout against the interest ledger', () => {
    const result = compareWalletCredits(
      wallet({
        interest: [
          {
            reference: 'PVB01INTEREST000000000000001',
            at: '2026-11-10T12:00:00.000Z',
          },
        ],
      }),
      [credit('PVB01INTEREST000000000000001', { category: 'interest' })],
      window
    );
    expect(result.findings).toEqual([]);
  });

  it('skips our own wallet-to-wallet transfers and counts them', () => {
    const result = compareWalletCredits(
      wallet(),
      [credit('PVB01P2P00000000000000000001', { category: 'p2p' })],
      window
    );
    expect(result).toEqual({ findings: [], internalSkipped: 1 });
  });

  it('ignores credits that are not successful or are still inside the settle time', () => {
    const result = compareWalletCredits(
      wallet(),
      [
        credit('PVB01PENDING000000000000001', { status: 'pending' }),
        credit('PVB01YOUNG00000000000000001', {
          createdAt: '2026-11-11T20:00:00.000Z',
        }),
      ],
      window
    );
    expect(result.findings).toEqual([]);
  });

  it('pages for a recorded inflow that PiggyVest does not list', () => {
    const result = compareWalletCredits(
      wallet({
        inflow: [
          {
            reference: 'PVB01RECORDEDONLY0000000001',
            at: '2026-11-10T12:00:00.000Z',
          },
        ],
      }),
      [],
      window
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'not_on_provider',
        reference: 'PVB01RECORDEDONLY0000000001',
      }),
    ]);
  });

  it('lists an unlisted interest payout for review without paging', async () => {
    const report = await runCreditGapCheck(
      ports(
        ledger([
          wallet({
            interest: [
              {
                reference: 'PVB01INTERESTONLY0000000001',
                at: '2026-11-10T12:00:00.000Z',
              },
            ],
          }),
        ])
      )
    );
    expect(report).toMatchObject({
      findings: [{ kind: 'interest_not_listed' }],
    });
    expect(creditGapPages(report)).toBe(false);
  });

  it('never flags recorded rows at the window edges, where clock skew can hide them', () => {
    const result = compareWalletCredits(
      wallet({
        inflow: [
          {
            reference: 'PVB01EDGE000000000000000001',
            at: '2026-11-08T23:10:00.000Z',
          },
        ],
      }),
      [],
      window
    );
    expect(result.findings).toEqual([]);
  });

  it.each([
    [{ outcome: 'unreadable' }, 'list_unreadable'],
    [{ outcome: 'incomplete', reason: 'order_unexpected' }, 'list_incomplete'],
  ] as const)('reports a wallet it could not read as unchecked and pages (%j)', async (listing, reason) => {
    const report = await runCreditGapCheck(ports(ledger([wallet()]), listing));
    expect(report).toMatchObject({
      walletsChecked: 0,
      unchecked: [{ walletId: 'plan-wallet-a', reason }],
    });
    expect(creditGapPages(report)).toBe(true);
  });

  it('never compares against a truncated ledger list', async () => {
    const checks = ports(ledger([wallet({ inflowTruncated: true })]));
    const report = await runCreditGapCheck(checks);
    expect(report).toMatchObject({
      unchecked: [{ reason: 'ledger_truncated' }],
    });
    expect(checks.listWalletCredits).not.toHaveBeenCalled();
  });

  it('starts no PiggyVest read once the budget is spent', async () => {
    const checks = { ...ports(ledger([wallet()])), expired: () => true };
    const report = await runCreditGapCheck(checks);
    expect(report).toMatchObject({ unchecked: [{ reason: 'deadline' }] });
    expect(checks.listWalletCredits).not.toHaveBeenCalled();
  });

  it('fails, and pages, when the ledger read is unavailable or malformed', async () => {
    const unavailable = await runCreditGapCheck({
      ...ports(null),
      loadLedger: async () => {
        throw new Error('down');
      },
    });
    const invalid = await runCreditGapCheck(ports({ rejected: true }));
    expect(unavailable).toEqual({
      status: 'failed',
      reason: 'snapshot_unavailable',
    });
    expect(invalid).toEqual({ status: 'failed', reason: 'snapshot_invalid' });
    expect(creditGapPages(invalid)).toBe(true);
  });
});
