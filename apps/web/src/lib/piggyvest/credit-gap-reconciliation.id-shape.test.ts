import { describe, expect, it } from 'vitest';
import { compareWalletCredits } from './credit-gap-reconciliation';

const window = {
  startMs: Date.parse('2026-11-08T23:00:00.000Z'),
  generatedMs: Date.parse('2026-11-11T23:00:00.000Z'),
};

function wallet(inflow: { reference: string; at: string }[] = []) {
  return {
    walletId: 'plan-wallet-a',
    inflow,
    inflowTruncated: false,
    interest: [],
    interestTruncated: false,
    unkeyed: 0,
  };
}

function credit(id: string, category = 'bank-inflow') {
  return {
    id,
    category,
    status: 'successful' as const,
    amountKobo: 250000,
    createdAt: '2026-11-10T12:00:00.000Z',
  };
}

describe('credit-gap guards against an unproven list id namespace', () => {
  it('treats a PVB-prefixed id outside the PVB01 credit namespace as unverified', () => {
    const { findings } = compareWalletCredits(
      wallet(),
      [credit('PVB99INTERNAL0000000000001')],
      window
    );

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'unverified_reference' }),
    ]);
  });

  it('lists a non-PVB-shaped list id for review instead of paging', () => {
    const { findings } = compareWalletCredits(
      wallet(),
      [credit('01M2TTNT0N08C81J5BEADH3BY8')],
      window
    );

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'unverified_reference' }),
    ]);
  });

  it('downgrades missing recorded inflows when no listed id is PVB-shaped', () => {
    const { findings } = compareWalletCredits(
      wallet([
        {
          reference: 'PVB01RECORDED0000000000001',
          at: '2026-11-10T12:00:00.000Z',
        },
      ]),
      [credit('01M2TTNT0N08C81J5BEADH3BY8')],
      window
    );

    expect(findings.map((finding) => finding.kind)).toEqual([
      'unverified_reference',
      'unverified_reference',
    ]);
  });

  it('still pages a PVB-shaped unrecorded credit and a missing recorded inflow', () => {
    const { findings } = compareWalletCredits(
      wallet([
        {
          reference: 'PVB01RECORDED0000000000001',
          at: '2026-11-10T12:00:00.000Z',
        },
      ]),
      [credit('PVB01MISSING00000000000001')],
      window
    );

    expect(findings.map((finding) => finding.kind)).toEqual([
      'unrecorded_credit',
      'not_on_provider',
    ]);
  });
});

describe('credit-gap internal-transfer category match', () => {
  it.each([
    'p2p',
    'P2P',
    ' p2p ',
  ])('skips the internal category %j regardless of case and spacing', (category) => {
    const result = compareWalletCredits(
      wallet(),
      [credit('PVB01INTERNAL0000000000001', category)],
      window
    );

    expect(result).toEqual({ findings: [], internalSkipped: 1 });
  });

  it('still pages an unknown category', () => {
    const { findings } = compareWalletCredits(
      wallet(),
      [credit('PVB01UNKNOWN00000000000001', 'wallet-transfer')],
      window
    );

    expect(findings).toEqual([
      expect.objectContaining({ kind: 'unrecorded_credit' }),
    ]);
  });
});
