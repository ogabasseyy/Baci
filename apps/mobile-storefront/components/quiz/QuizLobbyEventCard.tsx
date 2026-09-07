import { QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS } from '@baci/shared/constants';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import coinsImage from '@/assets/quiz/png/Coins.png';
import { useTheme } from '@/hooks/useTheme';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { QuizEvent } from '@/services/quiz-types';
import type { createQuizLobbyStyles } from './QuizLobby.styles';
import {
  formatQuizClock,
  formatRemainingTime,
  getEventStartButtonText,
  getPrizeMomentLabel,
} from './QuizScreen.utils';
import { useQuizEventTimer } from './use-quiz-event-timer';
import { useQuizServerClock } from './use-quiz-server-clock';

type QuizStyles = ReturnType<typeof createQuizLobbyStyles>;

interface QuizLobbyEventCardProps {
  event: QuizEvent;
  isSignedIn?: boolean;
  isResume: boolean;
  isStarting: boolean;
  locale?: string;
  onExpire?: () => void | Promise<void>;
  onEnterWaitingRoom?: () => void;
  onOpenRules: (requiresAcceptance: boolean) => void;
  onResume: () => void;
  onSignIn?: () => void;
  serverNow?: string;
  styles: QuizStyles;
}

export function QuizLobbyEventCard({
  event,
  isSignedIn = true,
  isResume,
  isStarting,
  locale,
  onExpire,
  onEnterWaitingRoom,
  onOpenRules,
  onResume,
  onSignIn,
  serverNow,
  styles,
}: QuizLobbyEventCardProps) {
  const { colors } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const serverClock = useQuizServerClock(serverNow ?? null);
  const { hasEnded, remainingSeconds } = useQuizEventTimer({
    eventEndsAt: event.endsAt,
    isActive: event.status === 'active',
    onExpire: () => {
      void onExpire?.();
    },
    shouldTick: event.status === 'active',
    serverClockOffsetMs: serverClock.offsetMs,
  });
  const deadlineHasEnded = Boolean(event.endsAt) && hasEnded;
  const effectiveStatus = deadlineHasEnded ? 'closed' : event.status;
  const isPlayable = effectiveStatus === 'open' || effectiveStatus === 'active';
  const isScheduled = effectiveStatus === 'scheduled';
  const isClosed = ['closed', 'completed', 'cancelled', 'finalizing'].includes(
    effectiveStatus
  );
  const canAct = isPlayable || isScheduled || isResume;
  const requiresSignIn = !isSignedIn && canAct;
  const buttonText = requiresSignIn
    ? 'Sign in to play'
    : isResume
      ? getEventStartButtonText('active', isStarting, true)
      : isScheduled
        ? 'Enter waiting room'
        : getEventStartButtonText(effectiveStatus, isStarting);
  const condition = event.prizeProduct?.condition?.replace('_', ' ');

  return (
    <View
      accessibilityLabel={`Quiz event ${event.title}, prize ${event.prizeName}`}
      style={[styles.eventCard, isClosed ? styles.eventCardClosed : undefined]}
    >
      <View style={styles.eventTopline}>
        <Text style={styles.prizeMoment}>
          {getPrizeMomentLabel(
            event,
            new Date(serverClock.serverNowMs).toISOString()
          )}
        </Text>
        <View
          style={event.mode === 'test' ? styles.testBadge : styles.liveBadge}
        >
          <Text style={styles.badgeText}>
            {event.mode === 'test'
              ? 'TEST'
              : effectiveStatus === 'active'
                ? 'LIVE'
                : 'QUIZ'}
          </Text>
        </View>
      </View>

      <View style={styles.prizeStage}>
        <View style={styles.prizeCopy}>
          <Text style={styles.eventTitle}>{event.title}</Text>
          <Text style={styles.eventPrize}>Win {event.prizeName}</Text>
          {condition ? (
            <Text style={styles.prizeCondition}>{condition}</Text>
          ) : null}
        </View>
        <View style={styles.prizeImageFrame}>
          <Image
            accessibilityLabel={`${event.prizeName} prize image`}
            autoplay={false}
            cachePolicy="memory-disk"
            contentFit="contain"
            onError={() => setImageFailed(true)}
            source={
              !imageFailed && event.prizeProduct?.imageUrl
                ? createSafeBoundedImageSource({
                    height: 150,
                    uri: event.prizeProduct.imageUrl,
                    width: 125,
                  })
                : coinsImage
            }
            style={styles.prizeImage}
          />
        </View>
      </View>

      {event.status === 'active' && event.endsAt && !deadlineHasEnded ? (
        <View style={styles.countdownRow}>
          <View style={styles.livePulse} />
          <Text accessibilityRole="timer" style={styles.countdownValue}>
            {formatRemainingTime(remainingSeconds)}
          </Text>
          <Text style={styles.countdownLabel}>until quiz ends</Text>
        </View>
      ) : null}

      <View style={styles.timingStrip}>
        <Text style={styles.timingFact}>{event.questionCount} questions</Text>
        <Text style={styles.timingDot}>•</Text>
        <Text style={styles.timingFact}>
          {event.timePerQuestionSeconds ??
            QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS}
          s each
        </Text>
        <Text style={styles.timingDot}>•</Text>
        <Text style={styles.timingFact}>
          {isClosed ? 'Closed' : 'Closes'}{' '}
          {formatQuizClock(event.endsAt, locale, event.timeZone)}
        </Text>
      </View>

      <View style={canAct ? styles.primaryButtonBox : styles.disabledButtonBox}>
        <Pressable
          accessibilityLabel={`${buttonText} ${event.title}`}
          accessibilityRole="button"
          accessibilityState={{
            disabled: isStarting || !canAct,
          }}
          disabled={isStarting || !canAct}
          onPress={
            requiresSignIn
              ? onSignIn
              : isResume
                ? onResume
                : isScheduled
                  ? onEnterWaitingRoom
                  : () => onOpenRules(true)
          }
          style={styles.primaryButton}
        >
          <Text
            style={
              canAct ? styles.primaryButtonText : styles.disabledButtonText
            }
          >
            {buttonText}
          </Text>
        </Pressable>
      </View>
      {isPlayable ? (
        <Text style={styles.everySecond}>Every second counts.</Text>
      ) : null}
      <Pressable
        accessibilityLabel={`View rules for ${event.title}`}
        accessibilityRole="button"
        onPress={() => onOpenRules(false)}
        style={styles.rulesLink}
      >
        <Ionicons
          name="information-circle-outline"
          size={17}
          color={colors.textSecondary}
        />
        <Text style={styles.rulesLinkText}>View rules</Text>
      </Pressable>
    </View>
  );
}
