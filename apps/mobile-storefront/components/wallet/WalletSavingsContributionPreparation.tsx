import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { PlanFundingLookup } from './savings/PlanFundingLookup';
import { startSavingsStyles as styles } from './savings/start-savings.styles';
import { useSavingsPlanFunding } from './savings/use-savings-plan-funding';
import { WalletSavingsContributionFlow } from './WalletSavingsContributionFlow';

type Props = ComponentProps<typeof WalletSavingsContributionFlow> & {
  goalId: string;
};

export function WalletSavingsContributionPreparation({
  goalId,
  ...flow
}: Props) {
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId);
  const activeMerchantId =
    pickMerchantId(merchantId, CONFIG.MERCHANT_ID) ?? undefined;
  const enabled = Boolean(userId && activeMerchantId);
  const scope = JSON.stringify([userId, activeMerchantId, goalId]);
  const scopeRef = useRef(scope);
  const mountedRef = useRef(true);
  const attemptedRef = useRef(false);
  const [earnInterest, setEarnInterest] = useState(false);
  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    attemptedRef.current = false;
    setEarnInterest(false);
  }
  const funding = useSavingsPlanFunding({
    activeMerchantId,
    activeMerchantSlug: CONFIG.MERCHANT_SLUG?.trim() || undefined,
    goalId: enabled ? goalId : null,
    identityKey: userId,
    loadExisting: enabled,
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const isCurrent = () => {
    const auth = useAuthStore.getState();
    return (
      mountedRef.current &&
      scopeRef.current === scope &&
      auth.user?.id === userId &&
      pickMerchantId(auth.merchantId, CONFIG.MERCHANT_ID) === activeMerchantId
    );
  };
  const loading =
    funding.planFundingPhase === 'idle' ||
    funding.planFundingPhase === 'loading';
  const canPrepare =
    funding.planFundingPhase === 'unprepared' &&
    !funding.planFundingRequiresBvn &&
    !attemptedRef.current;
  const prepare = () => {
    if (!enabled || !isCurrent() || !canPrepare || attemptedRef.current) return;
    attemptedRef.current = true;
    void funding.fetchPlanFunding('', { enableInterestAccrual: earnInterest });
  };
  if (!enabled)
    return (
      <Text style={{ color: flow.colors.textSecondary }}>
        Sign in to add to this savings plan.
      </Text>
    );
  if (
    funding.planFundingPhase === 'ready' &&
    !funding.planFundingRequiresBvn &&
    funding.planFundingAccounts.some((account) =>
      /^\d{10}$/.test(account.accountNumber)
    )
  )
    return (
      <WalletSavingsContributionFlow
        {...flow}
        onAddSavings={() => {
          if (isCurrent()) flow.onAddSavings();
        }}
      />
    );
  return (
    <View style={{ gap: 12 }}>
      <Text style={[styles.modalTitle, { color: flow.colors.text }]}>
        Set up this savings plan
      </Text>
      <Text style={{ color: flow.colors.textSecondary }}>
        Your goal is saved. Prepare its payment account before adding money from
        your wallet.
      </Text>
      {canPrepare ? (
        <PlanFundingLookup
          colors={flow.colors}
          controller={{
            planFundingPhase: funding.planFundingPhase,
            planFundingRequiresBvn: false,
            planFundingError: null,
            isSubmitting: flow.isAdding || flow.isFundPending,
          }}
          bvn=""
          earnInterest={earnInterest}
          onBvnChange={() => undefined}
          onEarnInterestChange={setEarnInterest}
          onFetch={prepare}
        />
      ) : (
        <>
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: flow.colors.textSecondary }}
          >
            {loading
              ? 'Checking your plan account…'
              : 'The plan account is not confirmed yet. Check its status before continuing.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check account status"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={() => {
              if (isCurrent() && !loading)
                void funding.fetchExistingPlanFunding();
            }}
            style={[
              styles.secondaryButton,
              { backgroundColor: BRAND.primary },
              loading && styles.buttonDisabled,
            ]}
          >
            <Text
              style={[styles.secondaryButtonText, { color: palette.white }]}
            >
              {loading ? 'Checking…' : 'Check account status'}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}
