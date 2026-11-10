import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, Stack, usePathname } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet, walletKeys } from '@/hooks/use-wallet';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { GoalLifecycleAction as Action } from './GoalLifecycleAction';
import {
  GOAL_LIFECYCLE_COPY as COPY,
  useGoalLifecycle,
} from './use-goal-lifecycle';
import { usePrimaryGoalGate } from './use-primary-goal-gate';
import { WalletPinSheet } from './WalletPinSheet';

/** Login URL whose way back keeps the goal and action (the route reads both). */
function loginHref(pathname: string, goalId: string, kind: GoalActionKind) {
  const back = `${pathname}?goalId=${encodeURIComponent(goalId)}&kind=${encodeURIComponent(kind)}`;
  return `/auth/login?returnTo=${encodeURIComponent(back)}` as const;
}

function useFindGoal(goalId: string) {
  const { data, isError, isLoading, refetch } = useWallet({
    cachePolicy: 'display',
  });
  const wallet = data?.wallet;
  const found =
    wallet?.savings_goals?.find((item) => item.id === goalId) ??
    (wallet?.active_savings_goal?.id === goalId
      ? wallet.active_savings_goal
      : undefined);
  // A finished action makes the goal vanish from the wallet data; keep what
  // was last seen so the screen does not lose its subject mid-flow.
  // Stored in state (adjusted during render, guarded by a comparison) rather
  // than a ref, so render stays pure.
  // The retained goal is also pinned to the signed-in user and merchant, so
  // it is never shown to another account.
  const userId = useAuthStore((state) => state.user?.id);
  const merchantId = useAuthStore((state) => state.merchantId);
  const scope = `${userId}:${merchantId}`;
  const [seen, setSeen] = useState<
    { goal: WalletActiveSavingsGoal; scope: string } | undefined
  >(undefined);
  if (found && (found !== seen?.goal || scope !== seen.scope))
    setSeen({ goal: found, scope });
  const retained =
    seen?.scope === scope && seen.goal.id === goalId ? seen.goal : undefined;
  return {
    goal: found ?? retained,
    isLoading: isLoading || !data,
    // The wallet finished with an error and nothing is cached to show.
    loadFailed: isError && !data,
    reload: () => void refetch(),
  };
}

export function GoalLifecycleScreen({
  kind,
  goalId,
}: {
  kind: GoalActionKind;
  goalId: string;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const copy = COPY[kind];
  const queryClient = useQueryClient();
  const auth = useRequireAuth();
  const [gateRetryNonce, setGateRetryNonce] = useState(0);
  const gate = usePrimaryGoalGate(undefined, gateRetryNonce);
  const { goal, isLoading, loadFailed, reload } = useFindGoal(goalId);
  const flow = useGoalLifecycle({ kind, goalId });
  const pathname = usePathname();

  if (auth.redirectTo)
    return <Redirect href={loginHref(pathname, goalId, kind)} />;
  // Until the session is restored (a cold-start deep link) the gate reads
  // 'off' only because nobody is signed in yet: wait, do not redirect.
  if (gate === 'off' && !auth.isLoading) return <Redirect href="/wallet" />;
  if (!auth.isLoading && !isLoading && !goal && flow.step === 'review')
    return <Redirect href="/wallet" />;

  const backToWallet = () => {
    void queryClient.invalidateQueries({ queryKey: walletKeys.all });
    router.replace('/wallet');
  };
  const leave = () => router.replace('/wallet');
  const signIn = () => router.replace(loginHref(pathname, goalId, kind));
  const gateError = gate === 'error';
  const checking = gate !== 'ready';
  // Continue stays off until the goal it would act on is on screen.
  const waiting = checking || !goal || auth.isLoading;
  const working = ['issuing', 'pin', 'submitting'].includes(flow.step);

  let title: string =
    flow.step === 'review' ? copy.reviewTitle : copy.screenTitle;
  let body: string | null = loadFailed
    ? COPY.walletLoadFailed
    : copy.reviewBody;
  let actions = (
    <>
      <Action
        colors={colors}
        label={waiting ? COPY.checking : copy.primary}
        onPress={() => void flow.begin()}
        primary
        busy={waiting}
      />
      {loadFailed ? (
        <Action colors={colors} label={COPY.tryAgain} onPress={reload} />
      ) : null}
      <Action colors={colors} label={copy.secondary} onPress={leave} />
    </>
  );
  if (flow.step === 'done') {
    title = copy.successTitle;
    body = copy.successBody;
    actions = (
      <Action
        colors={colors}
        label={COPY.backToWallet}
        onPress={backToWallet}
        primary
      />
    );
  } else if (flow.step === 'polling' || flow.step === 'timed_out') {
    if (flow.step === 'timed_out') title = COPY.stillProcessing;
    body = COPY.pending;
    actions =
      flow.step === 'timed_out' ? (
        <>
          {flow.needsSignIn ? (
            <Action
              colors={colors}
              label={COPY.signIn}
              onPress={signIn}
              primary
            />
          ) : null}
          <Action
            colors={colors}
            label={COPY.checkAgain}
            onPress={() => void flow.checkAgain()}
            primary
          />
          <Action colors={colors} label={COPY.backToWallet} onPress={leave} />
        </>
      ) : (
        <Action colors={colors} label={COPY.backToWallet} onPress={leave} />
      );
  } else if (flow.step === 'pin_cancelled') {
    body = COPY.pinCancelled;
    actions = (
      <>
        <Action
          colors={colors}
          label={COPY.tryAgain}
          onPress={() => void flow.retryPin()}
          primary
          busy={gate !== 'ready'}
        />
        <Action colors={colors} label={copy.secondary} onPress={leave} />
      </>
    );
  } else if (flow.step === 'failed' || flow.step === 'needs_review') {
    body = null;
    actions = (
      <>
        {flow.needsSignIn ? (
          <Action
            colors={colors}
            label={COPY.signIn}
            onPress={signIn}
            primary
          />
        ) : null}
        {flow.canStartAgain ? (
          <Action
            colors={colors}
            label={COPY.startAgain}
            onPress={() => void flow.begin()}
            primary
            busy={gate !== 'ready'}
          />
        ) : null}
        <Action
          colors={colors}
          label={COPY.backToWallet}
          onPress={backToWallet}
        />
      </>
    );
  }

  if (
    gateError &&
    ['review', 'pin_cancelled', 'failed', 'needs_review'].includes(flow.step)
  ) {
    body = 'We couldn’t check your wallet. Please try again.';
    actions = (
      <>
        <Action
          colors={colors}
          label={COPY.tryAgain}
          onPress={() => setGateRetryNonce((nonce) => nonce + 1)}
          primary
        />
        <Action colors={colors} label={COPY.backToWallet} onPress={leave} />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: copy.screenTitle }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          {title}
        </Text>
        {goal ? (
          <View style={styles.goal}>
            <Text style={[styles.goalTitle, { color: colors.text }]}>
              {goal.title}
            </Text>
            <Text style={{ color: colors.textSecondary }}>
              {`${COPY.savedSoFar}: ${formatNgnCurrency(goal.current_amount)}`}
            </Text>
          </View>
        ) : null}
        {body ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {body}
          </Text>
        ) : null}
        {flow.message ? (
          <Text
            accessibilityRole="alert"
            style={[styles.body, { color: colors.error }]}
          >
            {flow.message}
          </Text>
        ) : null}
        {working || flow.step === 'polling' ? (
          <ActivityIndicator color={colors.primary} />
        ) : null}
        {working ? null : <View style={styles.actions}>{actions}</View>}
      </ScrollView>
      <WalletPinSheet colors={colors} {...flow.sheetProps} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 20 },
  title: { fontSize: 20, fontWeight: '700' },
  goal: { gap: 4 },
  goalTitle: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 22 },
  actions: { gap: 10 },
});
