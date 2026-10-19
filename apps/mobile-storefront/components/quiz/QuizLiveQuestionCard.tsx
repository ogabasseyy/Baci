import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { QuizV2Attempt } from '@/services/quiz-types';
import type { createQuizStyles } from './QuizScreen.styles';
import { useQuizEventTimer } from './use-quiz-event-timer';
import { useQuizQuestionTimer } from './use-quiz-question-timer';
import { useQuizServerClock } from './use-quiz-server-clock';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizLiveQuestionCardProps {
  attempt: QuizV2Attempt;
  isSubmitting?: boolean;
  lockedOptionId: string | null;
  onAnswer: (optionId: string) => void;
  onEventExpire?: () => void;
  onRetryEventExpire?: () => void;
  onRetryLockedAnswer?: () => void;
  expiryRetryable?: boolean;
  styles: QuizStyles;
}

export function QuizLiveQuestionCard({
  attempt,
  isSubmitting = false,
  lockedOptionId,
  onAnswer,
  onEventExpire = () => undefined,
  onRetryEventExpire,
  onRetryLockedAnswer,
  styles,
  expiryRetryable = false,
}: QuizLiveQuestionCardProps) {
  const question = attempt.question;
  const universalExpiryStartedRef = useRef(false);
  const questionIdRef = useRef(question?.id ?? null);
  if (questionIdRef.current !== (question?.id ?? null)) {
    questionIdRef.current = question?.id ?? null;
    universalExpiryStartedRef.current = false;
  }
  const { offsetMs } = useQuizServerClock(attempt.serverNow);
  useQuizEventTimer({
    eventEndsAt: attempt.eventEndsAt,
    isActive: attempt.status === 'in_progress',
    onExpire: () => {
      universalExpiryStartedRef.current = true;
      onEventExpire();
    },
    serverClockOffsetMs: offsetMs,
  });
  const questionTimer = useQuizQuestionTimer({
    deadlineAt: question?.deadlineAt,
    eventEndsAt: attempt.eventEndsAt,
    hasSelection: lockedOptionId !== null,
    isActive:
      attempt.status === 'in_progress' && Boolean(question) && !isSubmitting,
    onExpire: () => {
      if (!universalExpiryStartedRef.current) onAnswer('__timeout_no_answer__');
    },
    questionId: question?.id ?? null,
    serverClockOffsetMs: offsetMs,
    timeLimitSeconds: question?.timeLimitSeconds ?? 0,
  });

  if (!question) return null;

  const progressPercent = Math.min(
    100,
    Math.max(0, (question.index / Math.max(1, question.total)) * 100)
  );
  const isUrgent = questionTimer.remainingSeconds <= 3;
  const timerColor = isUrgent
    ? styles.timerBadgeUrgentText.color
    : styles.timerBadgeText.color;

  return (
    <View style={styles.questionCard}>
      <View style={styles.questionHeader}>
        <View style={styles.questionPosition}>
          <Text style={styles.questionEyebrow}>QUESTION {question.index}</Text>
          <Text style={styles.questionCount}>of {question.total}</Text>
        </View>
        <View
          style={[
            styles.timerBadge,
            isUrgent ? styles.timerBadgeUrgent : undefined,
          ]}
        >
          <Ionicons name="timer-outline" size={18} color={timerColor} />
          <Text
            accessibilityRole="timer"
            style={[
              styles.timerBadgeText,
              isUrgent ? styles.timerBadgeUrgentText : undefined,
            ]}
          >
            {questionTimer.remainingSeconds}s left
          </Text>
        </View>
      </View>
      <View
        accessibilityLabel={`Question ${question.index} of ${question.total}`}
        accessibilityRole="progressbar"
        accessibilityValue={{
          max: question.total,
          min: 1,
          now: question.index,
        }}
        style={styles.progressTrack}
      >
        <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
      </View>
      <Text style={styles.question}>{question.prompt}</Text>
      <View style={styles.answersList}>
        {question.options.map((option, index) => {
          const selected = lockedOptionId === option.id;
          const disabled =
            expiryRetryable || lockedOptionId !== null || isSubmitting;
          return (
            <Pressable
              key={option.id}
              accessibilityLabel={`Answer ${option.label}`}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              disabled={disabled}
              onPress={() => onAnswer(option.id)}
              style={[
                styles.answerButton,
                selected ? styles.answerButtonSelected : undefined,
                disabled && !selected ? styles.answerButtonDisabled : undefined,
              ]}
            >
              <Text
                style={[
                  styles.answerLetter,
                  selected ? styles.answerLetterSelected : undefined,
                ]}
              >
                {String.fromCharCode(65 + index)}
              </Text>
              <Text style={styles.answerText}>{option.label}</Text>
              <View style={styles.answerSelectionIcon}>
                {selected ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={23}
                    color={styles.timerBadgeText.color}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {expiryRetryable ? (
        <>
          <Text style={styles.eventMeta}>
            We could not confirm the quiz end. Retry to see your results.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry ending quiz"
            onPress={onRetryEventExpire}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Retry ending quiz</Text>
          </Pressable>
        </>
      ) : onRetryLockedAnswer && lockedOptionId && !isSubmitting ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry saving answer"
          onPress={onRetryLockedAnswer}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Retry</Text>
        </Pressable>
      ) : null}
      {!isSubmitting ? (
        <View style={styles.answerHintRow}>
          <Ionicons
            name="lock-closed-outline"
            size={14}
            color={styles.answerHint.color}
          />
          <Text style={styles.answerHint}>Your first tap is final</Text>
        </View>
      ) : null}
    </View>
  );
}
