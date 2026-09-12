import { Pressable, ScrollView, Text, View } from 'react-native';
import { useQuizRewardedBadge } from '@/hooks/use-quiz-rewarded-badge';
import { useTheme } from '@/hooks/useTheme';
import type { QuizEvent } from '@/services/quiz-types';
import { useAuthStore } from '@/stores/auth-store';
import { QuizRewardedBadgeOffer } from './QuizRewardedBadgeOffer';
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
  const waitingRoom: QuizWaitingRoomState = useQuizWaitingRoom({
    event,
    onEventsUpdated,
    onExit,
    onStart,
    refresh,
  });
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
        accessibilityLabel="Scrollable SuperQuiz waiting room"
        contentContainerStyle={styles.scrollContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
        <View style={styles.card}>
          <Text style={styles.eyebrow}>SuperQuiz waiting room</Text>
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
          <Pressable
            accessibilityLabel="Leave waiting room"
            accessibilityRole="button"
            onPress={onExit}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Leave waiting room</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
