import { createHash } from 'node:crypto';

export interface SavingsGoalRow {
  break_fee_percent: number | string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  contribution_amount: number | string;
  contribution_frequency: 'daily' | 'weekly' | 'monthly';
  created_at: string;
  current_amount: number | string;
  future_debits_cancelled_at: string | null;
  id: string;
  initial_contribution_amount: number | string;
  maturity_date: string;
  metadata: Record<string, unknown> | null;
  preferred_debit_time: string | null;
  product_id: string;
  product_snapshot: Record<string, unknown> | null;
  saved_payment_method_id: string | null;
  source_mode: 'manual' | 'auto_debit';
  spent_at: string | null;
  start_date: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'spent';
  target_amount: number | string;
  title: string;
  updated_at: string;
  variant_id: string | null;
}

interface CreateSavingsGoalRpcResult {
  contribution_id: string | null;
  current_amount: number | string;
  goal_id: string;
  goal_status: string;
  success: boolean;
  wallet_balance: number | string;
}

function isNumberLike(value: unknown) {
  return typeof value === 'number' || typeof value === 'string';
}

function isCreateSavingsGoalRpcResult(
  row: unknown
): row is CreateSavingsGoalRpcResult {
  if (typeof row !== 'object' || row === null) {
    return false;
  }

  const record = row as Record<string, unknown>;
  return (
    (record.contribution_id === null ||
      typeof record.contribution_id === 'string') &&
    isNumberLike(record.current_amount) &&
    typeof record.goal_id === 'string' &&
    typeof record.goal_status === 'string' &&
    typeof record.success === 'boolean' &&
    isNumberLike(record.wallet_balance)
  );
}

export function toSavingsRouteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type GoalRequestFingerprintInput = {
  breakFeePercent?: number | null;
  contributionAmount: number;
  contributionFrequency: string;
  earlyEndFeeAccepted?: boolean | null;
  initialContributionAmount?: number | null;
  maturityDate: string;
  metadata?: Record<string, unknown> | null;
  preferredDebitTime?: string | null;
  productId: string;
  savedPaymentMethodId?: string | null;
  sourceMode: string;
  startDate: string;
  targetAmount: number;
  title: string;
  variantId?: string | null;
};

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonicalizeJson((value as Record<string, unknown>)[key]),
        ])
    );
  }
  return value;
}

/**
 * Canonical fingerprint of the raw requested plan (pre-catalogue
 * resolution). Persisted with the goal and compared on key reuse: an
 * identical retry replays even if the catalogue drifted, while an edited
 * plan mismatches instead of silently returning the stale goal. Never
 * compare resolved values (e.g. catalogue-raised targets) here — drift is
 * not a user edit.
 *
 * Every caller-controlled persisted field is covered: title, metadata
 * (key-order canonicalized), and fee consent alongside the money fields,
 * so a retry that edits any of them falls through to the RPC's
 * mismatched_goal_idempotency_payload instead of replaying stale evidence.
 */
export function buildGoalRequestFingerprint(
  input: GoalRequestFingerprintInput
): string {
  const canonical = JSON.stringify([
    input.productId,
    input.variantId ?? null,
    input.targetAmount,
    input.initialContributionAmount ?? 0,
    input.contributionAmount,
    input.contributionFrequency,
    input.preferredDebitTime ?? null,
    input.startDate,
    input.maturityDate,
    input.sourceMode,
    input.savedPaymentMethodId ?? null,
    input.breakFeePercent ?? 0,
    input.title,
    canonicalizeJson(input.metadata ?? {}),
    input.earlyEndFeeAccepted ?? null,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function mapSavingsRpcErrorStatus(message: string, code?: string) {
  const normalized = message.toLowerCase();
  if (
    code === '22023' ||
    normalized.includes('invalid_') ||
    normalized.includes('required') ||
    normalized.includes('must be')
  ) {
    return 400;
  }

  if (code === '42501' || normalized.includes('not_authorized')) {
    return 403;
  }

  if (
    normalized.includes('not_found') ||
    normalized === 'variant_not_available_for_savings'
  ) {
    return 404;
  }

  if (
    normalized === 'saved_payment_method_not_available_for_savings' ||
    normalized.includes('mismatched_goal_idempotency_payload') ||
    normalized.includes('insufficient_wallet_balance') ||
    normalized.includes('not_allocatable') ||
    normalized.includes('not_paused') ||
    normalized.includes('not_resumed') ||
    normalized.includes('not_swappable') ||
    normalized.includes('below_current_savings') ||
    normalized.includes('exceeds_remaining_target') ||
    normalized.includes('duplicate_savings_contribution_idempotency_key')
  ) {
    return 409;
  }

  return 500;
}

export function toSavingsRpcError(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const record = error as { code?: unknown; message?: unknown };
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    message:
      typeof record.message === 'string'
        ? record.message
        : 'Savings request failed',
  };
}

export function formatSavingsGoal(row: SavingsGoalRow) {
  return {
    breakFeePercent: toSavingsRouteNumber(row.break_fee_percent),
    cancelledAt: row.cancelled_at,
    completedAt: row.completed_at,
    contributionAmount: toSavingsRouteNumber(row.contribution_amount),
    contributionFrequency: row.contribution_frequency,
    createdAt: row.created_at,
    currentAmount: toSavingsRouteNumber(row.current_amount),
    futureDebitsCancelledAt: row.future_debits_cancelled_at,
    id: row.id,
    initialContributionAmount: toSavingsRouteNumber(
      row.initial_contribution_amount
    ),
    maturityDate: row.maturity_date,
    metadata: row.metadata ?? {},
    preferredDebitTime: row.preferred_debit_time,
    productId: row.product_id,
    productSnapshot: row.product_snapshot ?? {},
    savedPaymentMethodId: row.saved_payment_method_id,
    sourceMode: row.source_mode,
    spentAt: row.spent_at,
    startDate: row.start_date,
    status: row.status,
    targetAmount: toSavingsRouteNumber(row.target_amount),
    title: row.title,
    updatedAt: row.updated_at,
    variantId: row.variant_id,
  };
}

export function resolveCreateGoalRpcRow(data: unknown) {
  const rows = Array.isArray(data) ? data : [];
  const row = rows[0];
  return isCreateSavingsGoalRpcResult(row) ? row : null;
}
