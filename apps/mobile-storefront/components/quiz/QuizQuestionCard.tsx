import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type { QuizAttempt } from '@/services/quiz-types';
import type { createQuizStyles } from './QuizScreen.styles';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizQuestionCardProps {
  attempt: QuizAttempt;
  isSubmitting: boolean;
  onSelectAnswer: (optionId: string) => void;
  onSubmit: () => void;
  remainingSeconds: number;
  selectedOptionId: string | null;
  styles: QuizStyles;
}

/**
 * The active-question view: progress bar, countdown, answer options, and the
 * submit button. Extracted from `QuizScreen` so each stays within the module
 * size guard; the parent owns the timer/store wiring and passes state down.
 */
export function QuizQuestionCard({
  attempt,
  isSubmitting,
  onSelectAnswer,
  onSubmit,
  remainingSeconds,
  selectedOptionId,
  styles,
}: QuizQuestionCardProps) {
  const questionProgressPercent = Math.min(
    100,
    Math.max(
      0,
      (attempt.question.index / Math.max(1, attempt.question.total)) * 100
    )
  );

  return (
    <View style={styles.questionCard}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`Question ${attempt.question.index} of ${attempt.question.total}`}
        accessibilityValue={{
          min: 1,
          max: Math.max(1, attempt.question.total),
          now: attempt.question.index,
        }}
        style={styles.progressTrack}
      >
        <View
          style={[
            styles.progressFill,
            {
              width: `${questionProgressPercent}%`,
            },
          ]}
        />
      </View>
      <Text
        accessibilityLabel={`Time left: ${remainingSeconds} seconds`}
        accessibilityLiveRegion="polite"
        style={styles.timer}
      >
        Time left: {remainingSeconds}s
      </Text>
      {/* Entry is free, so this normally reports 0. Not hard-coded: an installed
          build can briefly talk to a database that still charges, and telling
          that player nothing was taken would misreport their balance. */}
      <Text style={styles.passReceipt}>
        {attempt.examPassPointsSpent > 0
          ? `${attempt.examPassPointsSpent} loyalty ${attempt.examPassPointsSpent === 1 ? 'point' : 'points'} used. ${attempt.remainingLoyaltyPoints} left.`
          : 'Free entry — no loyalty points used.'}
      </Text>
      <Text accessibilityRole="header" style={styles.question}>
        {attempt.question.prompt}
      </Text>
      {attempt.question.options.map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="button"
          accessibilityLabel={`Answer ${option.label}`}
          disabled={isSubmitting}
          accessibilityState={{
            disabled: isSubmitting,
            selected: selectedOptionId === option.id,
          }}
          onPress={() => {
            onSelectAnswer(option.id);
          }}
          style={[
            styles.answerButton,
            selectedOptionId === option.id && styles.answerButtonSelected,
            isSubmitting && styles.answerButtonDisabled,
          ]}
        >
          <Text style={styles.answerText}>{option.label}</Text>
          <View style={styles.answerSelectionIcon}>
            {selectedOptionId === option.id ? (
              <Ionicons
                accessibilityLabel="Selected answer"
                name="checkmark-circle"
                size={23}
                color={styles.answerButtonSelected.borderColor}
              />
            ) : null}
          </View>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Submit answer"
        accessibilityState={{
          disabled: !selectedOptionId || isSubmitting,
        }}
        disabled={!selectedOptionId || isSubmitting}
        onPress={onSubmit}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Submit answer</Text>
      </Pressable>
    </View>
  );
}
