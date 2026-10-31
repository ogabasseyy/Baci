import type { Answer } from './types';

/**
 * Pure analysis of a wallet readback for interest-payout evidence. Only
 * field PATHS and whether a value equals a known wallet id are reported;
 * values themselves never leave this function.
 */

export interface PayoutReadback {
  /** Interest/payout/accrual settings (rate fields are listed separately). */
  interestFieldPaths: string[];
  rateFieldPaths: string[];
  /** Fields that can hold a payout destination (key mentions payout), whatever their value. */
  payoutFieldPaths: string[];
  matchesTarget: string[];
  matchesOwn: string[];
  /** True/false if a boolean accrual/enabled setting exists; null if none. */
  accrualEnabled: boolean | null;
}

const SETTING = /interest|payout|accrual/i;
const RATE = /rate|percent/i;
const FLAG = /accrual|enable/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function analysePayoutReadback(
  data: unknown,
  targetWalletId: string,
  ownWalletId: string | null
): PayoutReadback {
  const out: PayoutReadback = {
    interestFieldPaths: [],
    rateFieldPaths: [],
    payoutFieldPaths: [],
    matchesTarget: [],
    matchesOwn: [],
    accrualEnabled: null,
  };
  const flags: boolean[] = [];

  const visit = (
    node: Record<string, unknown>,
    prefix: string,
    depth: number
  ) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (SETTING.test(key) || (prefix && SETTING.test(prefix))) {
        if (RATE.test(key)) {
          out.rateFieldPaths.push(path);
        } else {
          out.interestFieldPaths.push(path);
          if (/payout/i.test(key)) out.payoutFieldPaths.push(path);
          if (value === targetWalletId) out.matchesTarget.push(path);
          if (ownWalletId !== null && value === ownWalletId)
            out.matchesOwn.push(path);
          if (typeof value === 'boolean' && FLAG.test(key)) flags.push(value);
        }
      }
      const nested = asRecord(value);
      if (nested && depth < 1) visit(nested, path, depth + 1);
    }
  };
  const root = asRecord(data);
  if (root) visit(root, '', 0);
  if (flags.length > 0) out.accrualEnabled = flags.some(Boolean);
  return out;
}

/** A field that can name the payout destination is visible (whatever its value). */
export function destinationReadable(facts: PayoutReadback | null): boolean {
  return (
    facts !== null &&
    (facts.payoutFieldPaths.length > 0 || facts.matchesTarget.length > 0)
  );
}

/**
 * Does the readback name the payout wallet that was set? `yes` on a match;
 * `no` only once a destination field is READABLE and does not match; `unknown`
 * while no destination field has been seen (it may simply not have appeared).
 */
export function destinationAnswer(facts: PayoutReadback | null): Answer {
  if (!facts) return 'unknown';
  if (facts.matchesTarget.length > 0) return 'yes';
  return destinationReadable(facts) ? 'no' : 'unknown';
}

const union = (a: readonly string[], b: readonly string[]): string[] => [
  ...new Set([...a, ...b]),
];

/**
 * Accumulates successive readbacks of one wallet: field paths are unioned and
 * a flag already seen is kept unless a later reading restates it.
 */
export function mergePayoutReadbacks(
  prior: PayoutReadback | null,
  next: PayoutReadback
): PayoutReadback {
  if (!prior) return next;
  return {
    interestFieldPaths: union(
      prior.interestFieldPaths,
      next.interestFieldPaths
    ),
    rateFieldPaths: union(prior.rateFieldPaths, next.rateFieldPaths),
    payoutFieldPaths: union(prior.payoutFieldPaths, next.payoutFieldPaths),
    matchesTarget: union(prior.matchesTarget, next.matchesTarget),
    matchesOwn: union(prior.matchesOwn, next.matchesOwn),
    accrualEnabled: next.accrualEnabled ?? prior.accrualEnabled,
  };
}

/**
 * Does a goal wallet with no payout of its own inherit the business wallet?
 * `no` needs a READABLE destination field (the very field that names the
 * destination on the main wallet) that is empty or differs. An omitted
 * destination, or unrelated interest settings, leave the answer unknown.
 */
export function inheritanceAnswer(
  goal: PayoutReadback | null,
  mainDestinationPaths: readonly string[]
): Answer {
  if (!goal) return 'unknown';
  if (goal.matchesTarget.length > 0) return 'yes';
  const readable = goal.payoutFieldPaths.some((path) =>
    mainDestinationPaths.includes(path)
  );
  return readable ? 'no' : 'unknown';
}
