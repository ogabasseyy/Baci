import { SavingsPushPayloadSchema } from '@/schemas/savings-notifications';

export function getSavingsPushNavigationTarget(
  payload: unknown,
  activeMerchantId: string | null
) {
  const parsed = SavingsPushPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.merchantId !== activeMerchantId)
    return null;

  return {
    params: { action: 'savings', savingsGoalId: parsed.data.goalId },
    screen: 'wallet' as const,
  };
}
