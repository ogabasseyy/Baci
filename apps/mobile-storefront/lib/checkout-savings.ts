import type { SavingsGoal } from '@/lib/customer-savings';

type CheckoutSavingsCartItem = {
  product_id?: string | null;
  variant_id?: string | null;
};

type RedeemableSavingsStatus = Extract<
  SavingsGoal['status'],
  'active' | 'paused' | 'completed'
>;

export const REDEEMABLE_SAVINGS_STATUSES = [
  'active',
  'paused',
  'completed',
] as const satisfies readonly RedeemableSavingsStatus[];

const REDEEMABLE_SAVINGS_STATUS_SET: ReadonlySet<SavingsGoal['status']> =
  new Set(REDEEMABLE_SAVINGS_STATUSES);

export function isRedeemableSavingsStatus(
  status: SavingsGoal['status']
): status is RedeemableSavingsStatus {
  return REDEEMABLE_SAVINGS_STATUS_SET.has(status);
}

export function goalMatchesCartItem(
  goal: SavingsGoal,
  item: CheckoutSavingsCartItem
): boolean {
  if (!item.product_id || item.product_id !== goal.productId) {
    return false;
  }

  return !goal.variantId
    ? item.variant_id == null
    : goal.variantId === item.variant_id;
}

export function getEligibleCheckoutSavingsGoal(
  goals: SavingsGoal[],
  items: CheckoutSavingsCartItem[]
): SavingsGoal | null {
  let bestGoal: SavingsGoal | null = null;

  for (const goal of goals) {
    if (!isRedeemableSavingsStatus(goal.status) || goal.currentAmount <= 0) {
      continue;
    }

    const matchesCart = items.some((item) => goalMatchesCartItem(goal, item));
    if (!matchesCart) {
      continue;
    }

    if (!bestGoal || goal.currentAmount > bestGoal.currentAmount) {
      bestGoal = goal;
    }
  }

  return bestGoal;
}
