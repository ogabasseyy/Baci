import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useSavingsSheetLock } from '../SavingsSheetLock';
import { GoalCancelRow as Row } from './GoalCancelRow';
import { GoalCancelButton as Button } from './GoalCancelStepParts';
import { styles } from './goal-cancel-step.styles';
import { goalCompleteBreakdown } from './goal-complete-breakdown';
import { GOAL_COMPLETE_STEP_COPY as COPY } from './goal-complete-step-copy';
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
 * Completing a goal inside the savings sheet: a celebration, the money that
 * moves to the wallet, what happens next, then the PIN (same sheet) and the
 * outcome. The purchase itself is finished by the store team.
 */
export function GoalCompleteStep({
  colors,
  flow,
  goal,
  onDone,
  onNotNow,
  onSignIn,
}: {
  colors: WalletColors;
  flow: Flow;
  goal: WalletActiveSavingsGoal;
  onDone: () => void;
  onNotNow: () => void;
  onSignIn: () => void;
}) {
  const { known, saved, interest, total } = goalCompleteBreakdown(goal);
  // A PIN retry can come mid-submit: the sheet stays open until it settles.
  // Locked while a request is out (issue or submit), so the sheet can't be
  // dismissed into a PIN prompt it no longer shows.
  useSavingsSheetLock(flow.step === 'issuing' || flow.step === 'submitting');
  const done = flow.step === 'done';
  // A plan can also be completed at its end date without reaching the target.
  // Celebrate only when the saved principal itself reached the target. With
  // no principal figure the balance may include interest, so the neutral
  // "plan is ready" wording is used instead.
  const reachedTarget =
    goal.principal_amount !== undefined &&
    goal.principal_amount !== null &&
    goal.principal_amount >= goal.target_amount;
  const working = ['issuing', 'pin', 'submitting', 'polling'].includes(
    flow.step
  );
  const green = colors.success;

  let actions = (
    <>
      <Button
        colors={colors}
        label={COPY.confirm}
        onPress={() => void flow.begin()}
        primary
      />
      <Button colors={colors} label={COPY.notNow} onPress={onNotNow} />
    </>
  );
  let note: string | null = null;
  if (done) {
    actions = (
      <Button colors={colors} label={COPY.done} onPress={onDone} primary />
    );
  } else if (flow.step === 'timed_out') {
    note = COPY.pending;
    actions = (
      <>
        {flow.needsSignIn ? (
          <Button
            colors={colors}
            label={COPY.signIn}
            onPress={onSignIn}
            primary
          />
        ) : null}
        <Button
          colors={colors}
          label={COPY.checkAgain}
          onPress={() => void flow.checkAgain()}
          primary={!flow.needsSignIn}
        />
        <Button colors={colors} label={COPY.close} onPress={onDone} />
      </>
    );
  } else if (flow.step === 'pin_cancelled') {
    note = COPY.pinCancelled;
    actions = (
      <>
        <Button
          colors={colors}
          label={COPY.tryAgain}
          onPress={() => void flow.retryPin()}
          primary
        />
        <Button colors={colors} label={COPY.notNow} onPress={onNotNow} />
      </>
    );
  } else if (flow.step === 'failed' || flow.step === 'needs_review') {
    actions = (
      <>
        {flow.needsSignIn ? (
          <Button
            colors={colors}
            label={COPY.signIn}
            onPress={onSignIn}
            primary
          />
        ) : null}
        {flow.canStartAgain ? (
          <Button
            colors={colors}
            label={COPY.tryAgain}
            onPress={() => void flow.begin()}
            primary={!flow.needsSignIn}
          />
        ) : null}
        <Button colors={colors} label={COPY.notNow} onPress={onNotNow} />
      </>
    );
  }

  return (
    <View style={styles.root} testID="goal-complete-step">
      <View style={[styles.icon, { backgroundColor: withAlpha(green, 0.12) }]}>
        <Ionicons
          name={done ? 'checkmark' : 'trophy'}
          size={26}
          color={green}
        />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        {done ? COPY.doneTitle : reachedTarget ? COPY.title : COPY.maturedTitle}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {/* Amount-neutral: the server moved the balance at confirmation,
            which can differ from the snapshot this review opened with. */}
        {done
          ? COPY.doneBodyUnknown(goal.title)
          : reachedTarget
            ? COPY.subtitle(goal.title)
            : COPY.maturedSubtitle(goal.title)}
      </Text>
      {done ? null : !known ? (
        <>
          {/* The stored balance, labelled as such: with interest unknown the
              amount that moves may be larger. */}
          <View style={[styles.card, { borderColor: colors.border }]}>
            <Row colors={colors} label={COPY.inThisGoal} value={total} />
          </View>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {COPY.unknownSplit}
          </Text>
        </>
      ) : (
        <View style={[styles.card, { borderColor: colors.border }]}>
          <Row colors={colors} label={COPY.saved} value={saved} />
          {interest > 0 ? (
            <Row colors={colors} label={COPY.interest} value={interest} />
          ) : null}
          <Row colors={colors} label={COPY.toWallet} value={total} total />
        </View>
      )}
      {flow.step === 'review' ? (
        <View style={styles.next}>
          <Text
            style={[
              styles.note,
              styles.nextTitle,
              { color: colors.textSecondary },
            ]}
          >
            {COPY.nextTitle}
          </Text>
          {COPY.next.map((line, index) => (
            <View key={line} style={styles.nextRow}>
              <View
                style={[
                  styles.nextDot,
                  { backgroundColor: colors.primaryLowOpacity },
                ]}
              >
                <Text style={[styles.nextNum, { color: colors.primary }]}>
                  {index + 1}
                </Text>
              </View>
              <Text style={[styles.nextText, { color: colors.text }]}>
                {line}
              </Text>
            </View>
          ))}
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
      {note ? (
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {note}
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
