import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { useColorScheme } from '@/components/useColorScheme';
import { SavingsPlanFundingDetails } from '@/components/wallet/savings/SavingsPlanFundingDetails';
import { useSavingsPlanFunding } from '@/components/wallet/savings/use-savings-plan-funding';
import Colors from '@/constants/Colors';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { setClipboardString } from '@/lib/clipboard';
import { CONFIG } from '@/lib/config';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';

type RouteParams = { amount?: string | string[]; goalId?: string | string[] };

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

// Accepts any UUID version/variant shape: goal ids live in a Postgres uuid
// column and the server-side requireActiveSavingsGoal lookup stays
// authoritative (unknown ids 404 there), so the client must not reject v6/v7.
function validGoalId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function parseRequestedAmount(value: string): number | null {
  // Strict decimal-only: Number() accepts hex ("0x10"), exponents, and
  // whitespace, so a crafted funding link must not reach the integer
  // comparison in a non-decimal shape.
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export default function SavingsPlanFundingRoute() {
  if (!isHostedStagingTestPaymentsEnabled()) {
    return <Redirect href="/wallet" />;
  }
  return <SavingsPlanFundingScreen />;
}

function SavingsPlanFundingScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const params = useLocalSearchParams<RouteParams>();
  const { isLoading: authLoading, redirectTo } = useRequireAuth();
  const merchantId = useAuthStore((state) => state.merchantId);
  const userId = useAuthStore((state) => state.user?.id);
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  const activeMerchantSlug = CONFIG.MERCHANT_SLUG?.trim() || undefined;
  const { data, isLoading, isRefetching, refetch } = useWallet({
    cachePolicy: 'strict',
  });
  const [copied, setCopied] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const goalId = stringParam(params.goalId);
  const activeGoal = data?.wallet.active_savings_goal ?? null;
  const remainingAmount = activeGoal
    ? Math.max(0, activeGoal.target_amount - activeGoal.current_amount)
    : 0;
  const requestedAmount = parseRequestedAmount(stringParam(params.amount));
  const amount =
    requestedAmount !== null && requestedAmount <= remainingAmount
      ? requestedAmount
      : null;
  const goalMatches =
    Boolean(userId) &&
    validGoalId(goalId) &&
    activeGoal?.id === goalId &&
    activeGoal.source_mode === 'manual' &&
    activeGoal.status === 'active';
  const isCurrentPlan = goalMatches && amount !== null;
  // The goal matches but the cached remaining balance is lower than the linked
  // amount: the link may be fine and the wallet cache stale, so prompt a
  // refresh instead of reporting the link as dead.
  const amountExceedsCachedRemaining =
    goalMatches &&
    requestedAmount !== null &&
    requestedAmount > remainingAmount;
  const funding = useSavingsPlanFunding({
    activeMerchantId: activeMerchantId ?? undefined,
    activeMerchantSlug,
    goalId: isCurrentPlan ? goalId : null,
    identityKey: userId,
    loadExisting: isCurrentPlan,
  });

  const refreshProgress = async () => {
    setRefreshNote(null);
    try {
      const result = await refetch();
      if (result.isError) {
        setRefreshNote('Unable to refresh plan progress. Please try again.');
        return;
      }
      setRefreshNote(
        'Plan progress checked. It updates after a confirmed contribution.'
      );
    } catch {
      setRefreshNote('Unable to refresh plan progress. Please try again.');
    }
  };

  if (authLoading || isLoading) {
    return <ActivityIndicator accessibilityLabel="Loading savings funding" />;
  }
  if (redirectTo) {
    return <Redirect href={redirectTo} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Fund savings by transfer' }} />
      <StorefrontScreenShell
        edges={['bottom']}
        style={{ backgroundColor: colors.background }}
      >
        <AppKeyboardAwareScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          testID="savings-plan-funding-scroll"
        >
          <Text style={[styles.title, { color: colors.text }]}>
            Fund your plan
          </Text>
          {!isCurrentPlan || amount === null || !activeMerchantId ? (
            <Text style={[styles.copy, { color: colors.error }]}>
              {amountExceedsCachedRemaining && activeMerchantId
                ? 'This funding link asks for more than your cached plan balance shows. Refresh plan progress below, then open the link again.'
                : 'This funding link no longer matches your active savings plan. Return to savings and choose the plan again.'}
            </Text>
          ) : (
            <SavingsPlanFundingDetails
              account={funding.planFundingAccounts[0]}
              amount={amount}
              copied={copied}
              error={funding.fundingError}
              goalTitle={activeGoal?.title ?? 'Savings plan'}
              // Same gate as the route redirect above: the bare hosted
              // flag alone must never enable staging copy.
              isHostedStaging={isHostedStagingTestPaymentsEnabled()}
              onCopy={async () => {
                const accountNumber =
                  funding.planFundingAccounts[0]?.accountNumber ?? '';
                if (accountNumber.trim() === '') {
                  setCopied(false);
                  return;
                }
                setCopied(await setClipboardString(accountNumber));
              }}
              onFetchExisting={() => void funding.fetchExistingPlanFunding()}
              onFetchWithIdentity={(bvn) => void funding.fetchPlanFunding(bvn)}
              phase={funding.planFundingPhase}
              requiresIdentity={
                funding.planFundingPhase === 'unavailable' &&
                funding.planFundingStatusCode === 'IDENTITY_INCOMPLETE'
              }
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh plan progress"
            disabled={isRefetching}
            onPress={() => void refreshProgress()}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary },
              isRefetching && styles.disabled,
            ]}
          >
            <Text
              style={[
                styles.primaryButtonText,
                { color: colors.primaryForeground },
              ]}
            >
              {isRefetching ? 'Refreshing...' : 'Refresh plan progress'}
            </Text>
          </Pressable>
          {refreshNote ? (
            <Text style={[styles.copy, { color: colors.textSecondary }]}>
              {refreshNote}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to savings"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={[styles.backText, { color: colors.textSecondary }]}>
              Back to savings
            </Text>
          </Pressable>
        </AppKeyboardAwareScrollView>
      </StorefrontScreenShell>
    </>
  );
}

const styles = StyleSheet.create({
  backButton: { alignSelf: 'center', padding: 12 },
  backText: { fontSize: 15, fontWeight: '600' },
  copy: { fontSize: 14, lineHeight: 21 },
  disabled: { opacity: 0.55 },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 16,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '700' },
  scrollContent: { flexGrow: 1, gap: 20, padding: 20 },
  title: { fontSize: 26, fontWeight: '800' },
});
