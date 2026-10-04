import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { SavingsPlanCardContribution } from './savings/SavingsPlanCardContribution';
import { SavingsPlanTransferPanel } from './savings/SavingsPlanTransferPanel';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';

type Props = {
  addAmount: string;
  colors: (typeof Colors)['light'];
  goal: WalletActiveSavingsGoal;
  onAddAmountChange: (value: string) => void;
  onRefreshWallet?: () => Promise<unknown>;
};

export function WalletSavingsPlanFunding({
  addAmount,
  colors,
  goal,
  onAddAmountChange,
  onRefreshWallet,
}: Props) {
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId);
  const activeMerchantId =
    pickMerchantId(merchantId, CONFIG.MERCHANT_ID) ?? undefined;
  const enabled = Boolean(userId && activeMerchantId);
  const manual = goal.source_mode === 'manual';
  const funding = useSavingsPlanFunding({
    activeMerchantId,
    activeMerchantSlug: CONFIG.MERCHANT_SLUG?.trim() || undefined,
    goalId: enabled && manual ? goal.id : null,
    identityKey: userId,
    loadExisting: enabled && manual,
  });

  const refreshFundingAndProgress = async () => {
    await funding.fetchExistingPlanFunding();
    const walletRefreshResult = await onRefreshWallet?.();
    if (
      walletRefreshResult &&
      typeof walletRefreshResult === 'object' &&
      'isError' in walletRefreshResult &&
      walletRefreshResult.isError
    ) {
      const queryError =
        'error' in walletRefreshResult ? walletRefreshResult.error : null;
      throw queryError ?? new Error('Unable to refresh savings progress.');
    }
  };

  if (!enabled) {
    return (
      <Text style={{ color: colors.textSecondary }}>
        Sign in to add to this savings plan.
      </Text>
    );
  }

  return (
    <View style={{ gap: 20 }}>
      {manual ? (
        <SavingsPlanTransferPanel
          key={JSON.stringify([userId, activeMerchantId, goal.id])}
          account={funding.planFundingAccounts[0]}
          colors={colors}
          error={funding.fundingError}
          onRefresh={refreshFundingAndProgress}
          phase={funding.planFundingPhase}
        />
      ) : null}
      <SavingsPlanCardContribution
        key={JSON.stringify([
          userId,
          activeMerchantId,
          goal.id,
          goal.source_mode,
        ])}
        amount={addAmount}
        colors={colors}
        goalId={goal.id}
        merchantId={activeMerchantId ?? ''}
        onAmountChange={onAddAmountChange}
        onRefreshWallet={onRefreshWallet}
        remainingAmount={Math.max(0, goal.target_amount - goal.current_amount)}
        sourceMode={goal.source_mode}
        userId={userId ?? ''}
      />
    </View>
  );
}
