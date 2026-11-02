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

/**
 * `earlierFlag` is the accrual flag an earlier poll of the same readback
 * showed (the flag can appear reads before the payout destination). The
 * latest record's own flag wins; the earlier one stands only when the latest
 * record shows none.
 */
export function readGoalRouting(
  record: Record<string, unknown> | null,
  ids: RoutingIds,
  earlierFlag: boolean | null = null
): GoalRoutingReading {
  if (!record) return { interestEnabled: null, payout: 'unread' };
  const flag = ACCRUAL_FIELDS.map((key) => record[key]).find(
    (value) => typeof value === 'boolean'
  );
  return {
    interestEnabled: typeof flag === 'boolean' ? flag : earlierFlag,
    payout: payoutOf(record, ids),
  };
}

/**
 * The later reading decides, field by field. The first reading stands when
 * the recheck was unread; its payout stands when the recheck omitted the
 * payout field (an omission says nothing about where interest goes); and its
 * accrual flag stands when the recheck did not show one.
 */
export function finalReading(
  atOnce: GoalRoutingReading,
  afterRecheck: GoalRoutingReading
): GoalRoutingReading {
  if (afterRecheck.payout === 'unread') return atOnce;
  const keepFirstPayout =
    afterRecheck.payout === 'absent' && atOnce.payout !== 'unread';
  return {
    interestEnabled: afterRecheck.interestEnabled ?? atOnce.interestEnabled,
    payout: keepFirstPayout ? atOnce.payout : afterRecheck.payout,
  };
}

export type RoutingVerdict = 'proven' | 'not_proven';

/**
 * Is interest accruing in the goal? The final readback's flag decides; the
 * setting the goal was created with stands when the readback showed none.
 */
export function accrualOn(
  reading: GoalRoutingReading,
  requested: boolean
): boolean {
  return reading.interestEnabled ?? requested;
}

/**
 * Only a readback naming the goal itself proves interest stays in the goal,
 * and only while interest accrues: an opted-out goal has none to route.
 */
export function goalRoutingVerdict(
  payout: PayoutPseudonym,
  accruing = true
): RoutingVerdict {
  return payout === 'self' && accruing ? 'proven' : 'not_proven';
}

/**
 * "Does interest stay in this goal?": yes only for self while interest
 * accrues; no when the readback names another wallet; unknown for null,
 * absent or unread, and for self on a goal with accrual off.
 */
export function staysInGoalAnswer(
  payout: PayoutPseudonym,
  accruing = true
): Answer {
  if (payout === 'self') return accruing ? 'yes' : 'unknown';
  if (payout === 'main' || payout === 'business' || payout === 'other')
    return 'no';
  return 'unknown';
}

/**
 * "Does goal (a), opted in with no payout of its own, inherit the customer's
 * business payout wallet?", from its final reading. Naming the business wallet
 * is a yes. A no needs the goal to name another wallet in the same field the
 * main wallet's readback used for its destination. null proves nothing either
 * way ('unobservable': only PiggyVest's written answer can settle it); absent,
 * unread, or a main wallet that never showed the field leave it unknown.
 */
export function inheritsBusinessPayoutAnswer(
  payout: PayoutPseudonym,
  mainDestinationPaths: readonly string[]
): Answer | 'unobservable' {
  if (payout === 'business') return 'yes';
  if (!mainDestinationPaths.includes(PAYOUT_FIELD)) return 'unknown';
  if (payout === 'self' || payout === 'main' || payout === 'other') return 'no';
  return payout === 'null' ? 'unobservable' : 'unknown';
}

/**
 * "Does goal (d), created with the business wallet as its payout, read back
 * naming that wallet?", from its final reading. Only a readback naming the
 * business wallet is a yes. A readable destination field that names anything
 * else, or is empty, is a no; a field the readback omitted, or no readback at
 * all, is unknown, never a no.
 */
export function explicitDestinationAnswer(payout: PayoutPseudonym): Answer {
  if (payout === 'business') return 'yes';
  return payout === 'absent' || payout === 'unread' ? 'unknown' : 'no';
}
