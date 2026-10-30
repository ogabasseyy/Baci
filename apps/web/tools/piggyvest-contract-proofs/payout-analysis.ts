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
