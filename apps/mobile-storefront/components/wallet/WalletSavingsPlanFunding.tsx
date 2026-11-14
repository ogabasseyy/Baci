import { useState } from 'react';
import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { SavingsPlanCardContribution } from './savings/SavingsPlanCardContribution';
import { SavingsPlanStatusNote } from './savings/SavingsPlanStatusNote';
import { SavingsPlanWalletNote } from './savings/SavingsPlanWalletNote';

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
  // Bumped after a successful wallet refresh so the status note re-reads the
  // goal's setup status (a pending goal may have become ready).
  const [statusRefreshes, setStatusRefreshes] = useState(0);
  const refreshProgress = async () => {
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
    setStatusRefreshes((count) => count + 1);
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
        <SavingsPlanWalletNote
          key={JSON.stringify([
            'wallet-note',
            userId,
            activeMerchantId,
            goal.id,
          ])}
          colors={colors}
          onRefresh={refreshProgress}
          primary={isPiggyvestPrimaryMerchant(activeMerchantId)}
        />
      ) : null}
      {manual ? (
        <SavingsPlanStatusNote
          key={JSON.stringify([
            'status-note',
            userId,
            activeMerchantId,
            goal.id,
            statusRefreshes,
          ])}
          colors={colors}
          goalId={goal.id}
          identityKey={userId ?? ''}
          merchantId={activeMerchantId ?? ''}
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
