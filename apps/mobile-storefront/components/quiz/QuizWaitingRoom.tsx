import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AdSlot } from '@/components/ads/AdSlot';
import { MODAL_DISMISS_FALLBACK_MS } from '@/constants/modal-dismiss';
import { useQuizRewardedBadge } from '@/hooks/use-quiz-rewarded-badge';
import { useTheme } from '@/hooks/useTheme';
import type { QuizEvent } from '@/services/quiz-types';
import { useAuthStore } from '@/stores/auth-store';
import { QuizRewardedBadgeOffer } from './QuizRewardedBadgeOffer';
import { QuizRulesModal } from './QuizRulesModal';
import { formatQuizClock, formatRemainingTime } from './QuizScreen.utils';
import { createQuizWaitingRoomStyles } from './QuizWaitingRoom.styles';
import {
  type QuizWaitingRoomState,
  useQuizWaitingRoom,
} from './use-quiz-waiting-room';

interface QuizWaitingRoomProps {
  event: QuizEvent;
  locale?: string;
  onEventsUpdated?: (events: QuizEvent[]) => void;
  onExit: () => void;
  onStart: (eventId: string, termsAccepted: true) => void;
  refresh: () => Promise<QuizEvent[]>;
}

export function QuizWaitingRoom({
  event,
  locale,
  onEventsUpdated,
  onExit,
  onStart,
  refresh,
}: QuizWaitingRoomProps) {
  const { colors } = useTheme();
  const styles = createQuizWaitingRoomStyles(colors);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [rulesVisible, setRulesVisible] = useState(false);
  // iOS keeps the native rules modal rendered through its dismissal
  // animation. Track dismissal separately so the base slot stays withheld
  // until the modal-owned slot is actually gone.
  const [rulesDismissed, setRulesDismissed] = useState(true);
  const waitingRoom: QuizWaitingRoomState = useQuizWaitingRoom({
    event,
    onEventsUpdated,
    onExit,
    onStart,
    refresh,
    // A pending interstitial must never present over the rules modal or its
    // dismissal animation.
    suspended: rulesVisible || !rulesDismissed,
  });

  useEffect(() => {
    if (rulesVisible || rulesDismissed) return undefined;
    const fallback = setTimeout(
      () => setRulesDismissed(true),
      MODAL_DISMISS_FALLBACK_MS
    );
    return () => clearTimeout(fallback);
  }, [rulesVisible, rulesDismissed]);
  const openRules = () => {
    setRulesDismissed(false);
    setRulesVisible(true);
  };
  const closeRules = () => {
    setRulesVisible(false);
  };
  const currentEvent = waitingRoom.event;
  const timePerQuestion = currentEvent.timePerQuestionSeconds ?? 10;
  const rewardedBadge = useQuizRewardedBadge({
    eventId: currentEvent.id,
    eventTitle: currentEvent.title,
    remainingSeconds: waitingRoom.remainingSeconds,
    status: currentEvent.status,
    userId,
  });

  return (
    <View
      accessibilityLabel={`Waiting room for ${currentEvent.title}`}
      style={styles.screen}
    >
      <ScrollView
        accessibilityLabel="Scrollable waiting room"
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Waiting room</Text>
          <Text style={styles.title}>{currentEvent.title}</Text>
          <Text style={styles.prize}>Win {currentEvent.prizeName}</Text>
          <View>
            <Text style={styles.countdownLabel}>Starts in</Text>
            <Text accessibilityRole="timer" style={styles.countdown}>
              {formatRemainingTime(waitingRoom.remainingSeconds)}
            </Text>
          </View>
          <View style={styles.meta}>
            <Text style={styles.metaText}>
              Scheduled for{' '}
              {formatQuizClock(
                currentEvent.startsAt,
                locale,
                currentEvent.timeZone
              )}
            </Text>
            <Text style={styles.metaText}>
              {currentEvent.questionCount} questions
            </Text>
            <Text style={styles.metaText}>{timePerQuestion}s per question</Text>
          </View>
          <QuizRewardedBadgeOffer {...rewardedBadge} />
          {waitingRoom.error ? (
            <Text style={styles.error}>{waitingRoom.error}</Text>
          ) : null}
          {/* While the rewarded ad loads, opening rules would let its LOADED
              callback present over the modal — hold the button until the
              watch settles. */}
          <Pressable
            accessibilityLabel="View quiz rules"
            accessibilityRole="button"
            accessibilityState={{ disabled: rewardedBadge.isWatching }}
            disabled={rewardedBadge.isWatching}
            onPress={openRules}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>View rules</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Leave waiting room"
            accessibilityRole="button"
            onPress={onExit}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Leave waiting room</Text>
          </Pressable>
        </View>
        {/* The rules modal mounts its own FOOTER_ANCHOR slot; unmount this
            one while it is visible so only one banner request is live per
            logical placement and delivery attributes to the visible screen.
            A presented pre-quiz interstitial or rewarded ad likewise owns
            the full screen: withhold the banner until it closes so nothing
            requests or refreshes while completely obscured. */}
        {rulesVisible ||
        !rulesDismissed ||
        waitingRoom.isFullscreenAdActive ||
        rewardedBadge.isWatching ? null : (
          <AdSlot placement="FOOTER_ANCHOR" />
        )}
      </ScrollView>
      <QuizRulesModal
        eventTitle={currentEvent.title}
        onClose={closeRules}
        onConfirm={closeRules}
        onDismissed={() => setRulesDismissed(true)}
        requiresAcceptance={false}
        timePerQuestionSeconds={timePerQuestion}
        visible={rulesVisible}
      />
    </View>
  );
}
