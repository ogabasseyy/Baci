import type { Answer } from './types';

/**
 * Where a goal sub-wallet's interest is routed, as far as a GET /wallet/:id
 * readback says. Pure: the payout destination leaves this module only as a
 * pseudonym relative to the wallets the proof knows, never as a value.
 *
 * Sandbox interest rates are 0%, so no payout can actually be observed here:
 * a readback is the strongest evidence the sandbox offers, and only one that
 * names the goal itself proves "interest stays in this goal". A null payout
 * proves nothing unless PiggyVest confirms in writing where it pays.
 */

/** The four goal variants proof 7 creates, each in its own journaled slot. */
export const GOAL_ROUTING_VARIANTS = [
  {
    id: 'a',
    slot: 'p7/goal_a',
    label: 'opted in, payout unset',
    accrual: true,
    payout: 'unset',
  },
  {
    id: 'b',
    slot: 'p7/goal_b',
    label: 'opted out (accrual off), payout unset',
    accrual: false,
    payout: 'unset',
  },
  {
    id: 'c',
    slot: 'p7/goal_c',
    label: "opted in, payout = the customer's main wallet",
    accrual: true,
    payout: 'main',
  },
  {
    id: 'd',
    slot: 'p7/goal_d',
    label: 'opted in, payout = the business wallet',
    accrual: true,
    payout: 'business',
  },
] as const;

export type GoalRoutingVariant = (typeof GOAL_ROUTING_VARIANTS)[number];

/** Each created goal is read once more this long after the first readback. */
export const GOAL_RECHECK_DELAY_MS = 5 * 60_000;

/**
 * PiggyVest's public API docs, read 2026-11-02 (wallet create, retrieve,
 * list, accrued interest, transaction fee, customer create and the
 * changelog): no endpoint changes a wallet's interest payout or accrual
 * after creation. The only documented PATCH,
 * /api/v1/business/api-fee-wallet-settings, sets who bears transfer fees.
 * Nothing undocumented is ever guessed or probed.
 */
export const POST_CREATION_PAYOUT_UPDATE_DOCUMENTED = false;
export const POST_CREATION_PAYOUT_DOCS_CHECKED = '2026-11-02';

/**
 * self/main/business/other: the payout field names that wallet. null: the
 * field is readable and empty. absent: a readback without the field.
 * unread: no successful readback.
 */
export type PayoutPseudonym =
  | 'self'
  | 'main'
  | 'business'
  | 'null'
  | 'other'
  | 'absent'
  | 'unread';

export interface RoutingIds {
  self: string;
  main: string | null;
  business: string;
}

export interface GoalRoutingReading {
  /** The accrual flag as read back; null when not shown or unread. */
  interestEnabled: boolean | null;
  payout: PayoutPseudonym;
}

const PAYOUT_FIELD = 'interest_payout_wallet';
/**
 * The live sandbox names the flag interest_enabled (2026-10-31 evidence);
 * the mock sandbox still echoes the request name.
 */
const ACCRUAL_FIELDS = ['interest_enabled', 'enable_interest_accrual'];

function payoutOf(
  record: Record<string, unknown>,
  ids: RoutingIds
): PayoutPseudonym {
  if (!Object.hasOwn(record, PAYOUT_FIELD)) return 'absent';
  const value = record[PAYOUT_FIELD];
  if (value === null || value === undefined || value === '') return 'null';
  if (value === ids.self) return 'self';
  if (ids.main !== null && value === ids.main) return 'main';
  if (value === ids.business) return 'business';
  return 'other';
}

export function readGoalRouting(
  record: Record<string, unknown> | null,
  ids: RoutingIds
): GoalRoutingReading {
  if (!record) return { interestEnabled: null, payout: 'unread' };
  const flag = ACCRUAL_FIELDS.map((key) => record[key]).find(
    (value) => typeof value === 'boolean'
  );
  return {
    interestEnabled: typeof flag === 'boolean' ? flag : null,
    payout: payoutOf(record, ids),
  };
}

/** The later reading decides; the first stands only if the recheck was unread. */
export function finalReading(
  atOnce: GoalRoutingReading,
  afterRecheck: GoalRoutingReading
): GoalRoutingReading {
  return afterRecheck.payout === 'unread' ? atOnce : afterRecheck;
}

export type RoutingVerdict = 'proven' | 'not_proven';

/** Only a readback naming the goal itself proves interest stays in the goal. */
export function goalRoutingVerdict(payout: PayoutPseudonym): RoutingVerdict {
  return payout === 'self' ? 'proven' : 'not_proven';
}

/**
 * "Does interest stay in this goal?": yes only for self; no when the
 * readback names another wallet; unknown for null, absent or unread.
 */
export function staysInGoalAnswer(payout: PayoutPseudonym): Answer {
  if (payout === 'self') return 'yes';
  if (payout === 'main' || payout === 'business' || payout === 'other')
    return 'no';
  return 'unknown';
}
