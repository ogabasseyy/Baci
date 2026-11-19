import type { MockOptions } from './mock-sandbox';

/**
 * Seeded random scenarios for the ground-truth oracle. Two kinds of option are
 * drawn independently:
 *
 *  - BEHAVIOUR (what the sandbox truly does: fees, counters, payout routing,
 *    shapes, pagers). These define the ground truth.
 *  - TURBULENCE (lag, outages, bursts of 503, 503s that keep a plausible body,
 *    dropped connections). These change what the harness can SEE, never what
 *    is true, so they may turn a finding `unknown` but must never turn it wrong.
 *
 * Lags stay below the polling budget: a change that lands after the budget is
 * outside the contract ("settles within the configured polling budget").
 */

export interface Scenario {
  seed: number;
  maxPolls: number;
  mock: Partial<MockOptions>;
}

/** Small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const READ_NEEDLES = [
  '/api/v1/customers',
  '/api/v1/wallet/api/wallet-type',
  '/api/v1/wallet/01M2T',
  '/api/v1/transaction?',
  '/api/v1/transaction/01M2T',
  '/api/v1/transaction/verify',
  '/accounts',
  '/api/v1/wallet/interests/accrued',
  'cursor=',
] as const;

const DROPPED_POSTS = [
  '/api/v1/transfer/wallet',
  '/api/v1/transfer/bank',
  '/api/v1/transfer/test/funding',
  '/api/v1/wallet/sub-account',
] as const;

const RETAINED_BODIES: readonly Record<string, unknown>[] = [
  { id: 'w', balance: 0, withdrawal_count: 0 },
  { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
  { paginatedPayload: { edges: [], pageInfo: { hasNextPage: false } } },
  { status: 'success', amount: 1 },
];

const STRESS_PROFILES = [
  'none',
  'none',
  'counters',
  'settlement',
  'balances',
  'lists',
  'outages',
] as const;

export function scenarioFor(seed: number): Scenario {
  const rnd = mulberry32(seed);
  const chance = (p: number) => rnd() < p;
  const int = (min: number, max: number) =>
    min + Math.floor(rnd() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const maxPolls = pick([4, 5, 6, 8]);
  /** Zero half of the time, otherwise anything the budget can still absorb. */
  const lag = () => (chance(0.5) ? 0 : int(1, maxPolls - 1));

  const mock: Partial<MockOptions> = {
    // behaviour
    repostReturnsOriginalDefault: chance(0.7),
    echoThirdPartyIdentifierOnCreate: chance(0.4),
    customerListContainer: pick([
      'paginatedPayload',
      'edges',
      'array',
    ] as const),
    customerListEchoesIdentifier: chance(0.7),
    walletListIncludesCreatedAt: chance(0.7),
    walletListIncludesCustomerId: chance(0.4),
    tsqShape: pick(['docs', 'rich'] as const),
    depositFeeKobo: pick([0, 1_000, 5_000]),
    depositFeeBorneByWallet: chance(0.7),
    transferFeeKobo: pick([0, 0, 1_000]),
    bankFeeKobo: pick([1_000, 5_000]),
    w2wIncrementsCounter: chance(0.3),
    bankIncrementsCounter: chance(0.7),
    counterScope: pick(['wallet', 'customer'] as const),
    fundingSettles: chance(0.94),
    customerPayoutWallet: chance(0.85) ? 'accepted' : 'rejected',
    subAccountAcceptsPayout: chance(0.8),
    subWalletInheritsPayout: chance(0.3),
    payoutReadback: pick(['fields', 'fields', 'accrual_only', 'none'] as const),
    goalReadbackOmitsPayout: chance(0.25),
    accruedEdgeCount: pick([0, 1, 3, 4]),
    goalInterestRate: chance(0.4) ? 0.05 : 0,
    pagingMode: pick([
      'advance',
      'advance',
      'rotating_cursor_same_rows',
      'stuck_cursor',
    ] as const),
    // turbulence
    balanceLagReads: lag(),
    listLagReads: lag(),
    settingsLagReads: lag(),
    payoutFieldLagReads: lag(),
    counterLagReads: lag(),
    counterLagReadsGoal: chance(0.5) ? null : lag(),
    tsqPendingPolls: chance(0.5) ? 1 : int(0, maxPolls - 2),
    tsqNotFoundPolls: chance(0.7) ? 0 : int(1, 2),
  };

  // Stress profiles force the combinations that have fooled the proofs before,
  // so they are exercised often instead of by chance.
  const profiles = [
    pick(STRESS_PROFILES),
    ...(chance(0.25) ? [pick(STRESS_PROFILES)] : []),
  ];
  for (const profile of profiles) {
    if (profile === 'counters') {
      // customer-scoped counters that become visible on each wallet at its own time
      mock.counterScope = 'customer';
      mock.w2wIncrementsCounter = true;
      mock.bankIncrementsCounter = chance(0.4);
      mock.counterLagReads = int(0, maxPolls - 1);
      mock.counterLagReadsGoal = int(0, maxPolls - 1);
    } else if (profile === 'settlement') {
      // the wallet transfer has really settled but TSQ still says pending,
      // while the bank outflow is confirmed at once
      mock.tsqSettleEarly = true;
      mock.tsqPendingPolls = int(maxPolls, maxPolls + 3);
      mock.tsqPendingPollsBank = int(0, 1);
      mock.w2wIncrementsCounter = true;
      mock.bankIncrementsCounter = false;
      mock.counterScope = 'customer';
      mock.counterLagReadsGoal = int(0, maxPolls - 1);
      mock.balanceLagReads = int(1, maxPolls - 1);
    } else if (profile === 'balances') {
      mock.balanceLagReads = int(1, maxPolls - 1);
      mock.tsqSettleEarly = chance(0.6);
      mock.tsqPendingPolls = int(0, maxPolls + 2);
      mock.fundingSettles = true;
    } else if (profile === 'lists') {
      mock.listLagReads = int(2, maxPolls - 1);
      mock.accruedEdgeCount = int(2, 4);
      mock.pagingMode = pick([
        'advance',
        'advance',
        'rotating_cursor_same_rows',
      ]);
    } else if (profile === 'outages') {
      // reads that keep failing now and then, often with a plausible body
      mock.flakyPaths = [
        {
          needle: pick(['/api/v1/wallet/01M2T', '/api/v1/transaction?']),
          skip: 0,
          fail: 0,
          every: int(2, 5),
        },
      ];
      mock.serverErrorData = chance(0.7)
        ? RETAINED_BODIES[0]
        : pick(RETAINED_BODIES);
    }
  }
  if (chance(0.22)) mock.serverErrorPaths = [pick(READ_NEEDLES)];
  if (chance(0.45)) {
    mock.flakyPaths = Array.from({ length: int(1, 2) }, () => ({
      needle: pick(READ_NEEDLES),
      skip: int(0, 8),
      fail: int(1, 3),
    }));
  }
  if ((mock.serverErrorPaths || mock.flakyPaths) && chance(0.6)) {
    mock.serverErrorData = pick(RETAINED_BODIES);
  }
  if (chance(0.12)) mock.failNetworkOnce = [pick(DROPPED_POSTS)];
  return { seed, maxPolls, mock };
}
