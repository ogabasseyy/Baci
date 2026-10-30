import { listSavingsGoals } from '@/lib/customer-savings';

export type SavingsTransferVerification = {
  goalId: string | null;
  amount: number;
  merchantId?: string;
  merchantSlug?: string;
  userId?: string;
};

export async function verifyStartSavingsTransfer(
  input?: SavingsTransferVerification
): Promise<boolean> {
  if (!input?.goalId || !Number.isFinite(input.amount) || input.amount <= 0) {
    return false;
  }
  const result = await listSavingsGoals({
    merchantId: input.merchantId,
    merchantSlug: input.merchantSlug,
  });
  const goal = result.goals.find((entry) => entry.id === input.goalId);
  return (
    goal !== undefined &&
    Math.round(goal.currentAmount * 100) >= Math.round(input.amount * 100)
  );
}
