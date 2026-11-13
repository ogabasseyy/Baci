import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { GoalCancelRow } from './GoalCancelRow';
import { GoalCancelButton } from './GoalCancelStepParts';
import { goalCancelBreakdown } from './goal-cancel-breakdown';
import { styles } from './goal-cancel-step.styles';
import { GOAL_CANCEL_STEP_COPY as COPY } from './goal-cancel-step-copy';
import type { useGoalLifecycle } from './use-goal-lifecycle';

type WalletColors = (typeof Colors)['light'];
type Flow = Pick<
  ReturnType<typeof useGoalLifecycle>,
  | 'step'
  | 'message'
  | 'canStartAgain'
  | 'needsSignIn'
  | 'begin'
  | 'retryPin'
  | 'checkAgain'
>;

/**
 * Cancelling a goal as a step inside the savings sheet: what happens to the
 * money, then the wallet PIN (shown in the same sheet), then the outcome.
 */
export function GoalCancelStep({
  colors,
  flow,
  goal,
  onDone,
  onKeep,
  onSignIn,
}: {
  colors: WalletColors;
  flow: Flow;
  goal: WalletActiveSavingsGoal;
  onDone: () => void;
  onKeep: () => void;
  onSignIn: () => void;
}) {
  const { known, saved, forfeited, refund } = goalCancelBreakdown(goal);
  const empty = saved <= 0 && forfeited <= 0;
  const done = flow.step === 'done';
  const working = ['issuing', 'pin', 'submitting', 'polling'].includes(
    flow.step
  );

  let body: string | null = empty
    ? COPY.emptyBody
    : !known
      ? COPY.unknownSplitNote
      : forfeited > 0
        ? COPY.forfeitNote
        : COPY.savedBody;
  let actions = (
    <>
      <GoalCancelButton
        colors={colors}
        label={COPY.confirm}
        onPress={() => void flow.begin()}
        primary
      />
      <GoalCancelButton colors={colors} label={COPY.keep} onPress={onKeep} />
    </>
  );
  if (done) {
    body = empty ? COPY.doneEmptyBody : COPY.doneBody;
    actions = (
      <GoalCancelButton
        colors={colors}
        label={COPY.done}
        onPress={onDone}
        primary
      />
    );
  } else if (flow.step === 'timed_out') {
    body = COPY.pending;
    actions = (
      <>
        {flow.needsSignIn ? (
          <GoalCancelButton
            colors={colors}
            label={COPY.signIn}
            onPress={onSignIn}
            primary
          />
        ) : null}
        <GoalCancelButton
          colors={colors}
          label={COPY.checkAgain}
          onPress={() => void flow.checkAgain()}
          primary={!flow.needsSignIn}
        />
        <GoalCancelButton colors={colors} label={COPY.close} onPress={onDone} />
      </>
    );
  } else if (flow.step === 'pin_cancelled') {
    body = COPY.pinCancelled;
    actions = (
      <>
        <GoalCancelButton
          colors={colors}
          label={COPY.tryAgain}
          onPress={() => void flow.retryPin()}
          primary
        />
        <GoalCancelButton colors={colors} label={COPY.keep} onPress={onKeep} />
      </>
    );
  } else if (flow.step === 'failed' || flow.step === 'needs_review') {
    body = null;
    actions = (
      <>
        {flow.needsSignIn ? (
          <GoalCancelButton
            colors={colors}
            label={COPY.signIn}
            onPress={onSignIn}
            primary
          />
        ) : null}
        {flow.canStartAgain ? (
          <GoalCancelButton
            colors={colors}
            label={COPY.tryAgain}
            onPress={() => void flow.begin()}
            primary={!flow.needsSignIn}
          />
        ) : null}
        <GoalCancelButton colors={colors} label={COPY.keep} onPress={onKeep} />
      </>
    );
  }

  const showBreakdown = known && !empty && !done;
  // Without the split, still show the goal's balance: a figure, not just a
  // sentence, and never presented as the refund.
  const showSaved = !known && !empty && !done;
  return (
    <View style={styles.root} testID="goal-cancel-step">
      <View
        style={[
          styles.icon,
          {
            backgroundColor: done
              ? withAlpha(colors.success, 0.12)
              : colors.primaryLowOpacity,
          },
        ]}
      >
        <Ionicons
          name={done ? 'checkmark' : 'trash-outline'}
          size={26}
          color={done ? colors.success : colors.primary}
        />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        {done ? COPY.doneTitle : COPY.title(goal.title)}
      </Text>
      {body ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {body}
        </Text>
      ) : null}
      {showSaved ? (
        <View style={[styles.card, { borderColor: colors.border }]}>
          <GoalCancelRow
            colors={colors}
            label={COPY.inThisGoal}
            value={goal.current_amount}
            total
          />
        </View>
      ) : null}
      {showBreakdown ? (
        <View style={[styles.card, { borderColor: colors.border }]}>
          <GoalCancelRow colors={colors} label={COPY.saved} value={saved} />
          {forfeited > 0 ? (
            <GoalCancelRow
              colors={colors}
              label={COPY.interestForfeited}
              value={forfeited}
              struck
            />
          ) : null}
          <GoalCancelRow
            colors={colors}
            label={COPY.backToWallet}
            value={refund}
            total
          />
        </View>
      ) : null}
      {flow.message ? (
        <Text
          accessibilityRole="alert"
          style={[styles.body, { color: colors.error }]}
        >
          {flow.message}
        </Text>
      ) : null}
      {flow.step === 'review' ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {COPY.pinNote}
        </Text>
      ) : null}
      {working ? (
        <View style={styles.working}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {flow.step === 'polling' ? COPY.pending : COPY.working}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>{actions}</View>
      )}
    </View>
  );
}
