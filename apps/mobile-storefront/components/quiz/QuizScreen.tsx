import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { getQuizMobileAdsConfig } from '@/config/quiz-mobile-ads';
import { useTheme } from '@/hooks/useTheme';
import { createLogger } from '@/lib/logger';
import {
  fetchQuizEvents,
  type QuizIntegrityTier,
  submitQuizAnswer,
} from '@/services/quiz';
import { submitQuizAnswerV2 } from '@/services/quiz-attempts';
import { useAuthStore } from '@/stores/auth-store';
import { useQuizStore } from '@/stores/quiz-store';
import { createQuizV2LifecycleHandlers } from './create-quiz-v2-lifecycle-handlers';
import { QuizErrorPanel } from './QuizErrorPanel';
import { QuizEventsList } from './QuizEventsList';
import { QuizGameplayAdFooter } from './QuizGameplayAdFooter';
import { QuizGateModals } from './QuizGateModals';
import { QuizLiveQuestionCard } from './QuizLiveQuestionCard';
import { createQuizLobbyStyles } from './QuizLobby.styles';
import { QuizMusicPlayer } from './QuizMusicPlayer';
import type { QuizMusicPlaybackState } from './QuizMusicPlayerNative';
import { QuizQuestionCard } from './QuizQuestionCard';
import { QuizResultsSection } from './QuizResultsSection';
import { createQuizStyles } from './QuizScreen.styles';
import { getQuizErrorMessage, shouldShowEventList } from './QuizScreen.utils';
import { createQuizAnswerHandlers } from './quiz-answer-handlers';
import { useQuizMobileAdsPrewarm } from './use-quiz-mobile-ads-prewarm';
import { useQuizMusicState } from './use-quiz-music-state';
import { useQuizQuestionTimer } from './use-quiz-question-timer';
import { useQuizResultPolling } from './use-quiz-result-polling';
import { useQuizStartFlow } from './useQuizStartFlow';

const log = createLogger('Quiz');

const QUIZ_COPY = {
  actionFailed: 'Quiz action failed',
} as const;

interface QuizScreenProps {
  integrityTier?: QuizIntegrityTier;
  locale?: string;
}
export function QuizScreen({
  integrityTier = 'basic',
  locale,
}: QuizScreenProps = {}) {
  const { colors } = useTheme();
  const styles = createQuizStyles(colors);
  const lobbyStyles = createQuizLobbyStyles(colors);
  const {
    status,
    events,
    attempt,
    v2Attempt,
    v2LifecycleStatus,
    v2Result,
    expiryRetryable,
    lockedOptionId,
    attemptIntegrityTier,
    selectedOptionId,
    result,
    error,
    terminalContext,
    loadEvents,
    startEvent,
    startEventV2,
    lockAndSubmitAnswer,
    selectAnswer,
    setError,
    submitSelectedAnswer,
    forfeitAnswer,
    expireActiveEvent,
    retryLockedAnswer,
    setV2Result,
  } = useQuizStore(
    useShallow((state) => ({
      status: state.status,
      events: state.events,
      attempt: state.attempt,
      v2Attempt: state.v2Attempt,
      v2LifecycleStatus: state.v2LifecycleStatus,
      v2Result: state.v2Result,
      expiryRetryable: state.expiryRetryable,
      lockedOptionId: state.lockedOptionId,
      attemptIntegrityTier: state.attemptIntegrityTier,
      selectedOptionId: state.selectedOptionId,
      result: state.result,
      error: state.error,
      terminalContext: state.terminalContext,
      loadEvents: state.loadEvents,
      startEvent: state.startEvent,
      startEventV2: state.startEventV2,
      lockAndSubmitAnswer: state.lockAndSubmitAnswer,
      selectAnswer: state.selectAnswer,
      setError: state.setError,
      submitSelectedAnswer: state.submitSelectedAnswer,
      forfeitAnswer: state.forfeitAnswer,
      expireActiveEvent: state.expireActiveEvent,
      retryLockedAnswer: state.retryLockedAnswer,
      setV2Result: state.setV2Result,
    }))
  );

  useQuizResultPolling({
    attemptId: terminalContext?.attemptId ?? null,
    enabled: status === 'result' && v2LifecycleStatus === 'pending_results',
    eventEndsAt: terminalContext?.eventEndsAt ?? null,
    expectedUserId: useAuthStore.getState().user?.id ?? null,
    onResult: setV2Result,
    serverNow: terminalContext?.serverNow ?? null,
  });

  useEffect(() => {
    let mounted = true;
    if (status === 'idle') {
      loadEvents(fetchQuizEvents).catch((error) => {
        log.warn('Failed to load quiz events', error);
        if (mounted) {
          setError(getQuizErrorMessage(error, QUIZ_COPY.actionFailed));
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, [loadEvents, setError, status]);

  useQuizMobileAdsPrewarm(getQuizMobileAdsConfig().enabled);

  const { dobGate, requestStart, usernameGate } = useQuizStartFlow({
    events,
    integrityTier,
    startEvent,
    startEventV2: async (context, starter) => {
      if (!context.userId) {
        setError('Your session changed. Please try again.');
        return;
      }
      await startEventV2({ ...context, userId: context.userId }, starter);
    },
  });

  const { handleSubmit, handleTimeExpired, handleV2Answer } =
    createQuizAnswerHandlers({
      attempt,
      attemptIntegrityTier,
      forfeitAnswer,
      getErrorMessage: getQuizErrorMessage,
      getUserId: () => useAuthStore.getState().user?.id,
      lockAndSubmitAnswer,
      logSubmitFailure: (error) =>
        log.warn('Failed to submit quiz answer', error),
      selectedOptionId,
      setError,
      status,
      submitLegacyAnswer: submitQuizAnswer,
      submitSelectedAnswer,
      submitV2Answer: submitQuizAnswerV2,
      v2Attempt,
    });

  const lifecycleHandlers = createQuizV2LifecycleHandlers({
    attempt: v2Attempt,
    expire: expireActiveEvent,
    lockedOptionId,
    retry: retryLockedAnswer,
    userId: useAuthStore.getState().user?.id,
  });

  const { remainingSeconds } = useQuizQuestionTimer({
    questionId: attempt?.question.id ?? null,
    timeLimitSeconds: attempt?.question.timeLimitSeconds ?? 0,
    deadlineAt: attempt?.question.deadlineAt,
    isActive: status === 'question',
    hasSelection: selectedOptionId !== null,
    onExpire: handleTimeExpired,
  });
  const music = useQuizMusicState({
    eventEndsAt: v2Attempt?.eventEndsAt ?? terminalContext?.eventEndsAt,
    hasActiveAttempt: Boolean(v2Attempt),
    lifecycle: v2LifecycleStatus,
    serverNow: v2Attempt?.serverNow ?? terminalContext?.serverNow,
    status,
  });
  const [musicPlayback, setMusicPlayback] = useState<QuizMusicPlaybackState>({
    currentTrackIndex: 0,
    isPlaying: true,
    positionSeconds: 0,
  });
  const musicPlayerPlayback = {
    initialPlayback: musicPlayback,
    onPlaybackChange: setMusicPlayback,
  };

  return (
    <View style={styles.screen}>
      {status === 'loading' ? (
        <View style={styles.container}>
          <ActivityIndicator accessibilityLabel="Loading quiz events" />
        </View>
      ) : null}

      {error && !dobGate.isGateVisible ? (
        <QuizErrorPanel
          description={error}
          onRetry={() => {
            void loadEvents(fetchQuizEvents);
          }}
          primaryColor={colors.primary}
          showRetry={status === 'ready' || status === 'error'}
          styles={styles}
        />
      ) : null}

      {!error && shouldShowEventList(status) ? (
        <QuizEventsList
          events={events}
          isStarting={status === 'starting'}
          locale={locale}
          onStart={requestStart}
          resumeEventId={v2Attempt?.eventId}
          serverNow={v2Attempt?.serverNow}
          styles={lobbyStyles}
        />
      ) : null}

      {(status === 'question' || status === 'submitting') && attempt ? (
        <ScrollView
          contentContainerStyle={styles.container}
          style={styles.gameplayScroll}
        >
          <QuizMusicPlayer {...musicPlayerPlayback} />
          <QuizQuestionCard
            attempt={attempt}
            isSubmitting={status === 'submitting'}
            onSelectAnswer={selectAnswer}
            onSubmit={() => {
              void handleSubmit();
            }}
            remainingSeconds={remainingSeconds}
            selectedOptionId={selectedOptionId}
            styles={styles}
          />
        </ScrollView>
      ) : null}

      {(status === 'question' || status === 'submitting') && v2Attempt ? (
        <ScrollView
          contentContainerStyle={styles.container}
          style={styles.gameplayScroll}
        >
          {music.shouldPlay ? (
            <QuizMusicPlayer
              gameEndsIn={music.gameEndsIn}
              {...musicPlayerPlayback}
            />
          ) : null}
          <QuizLiveQuestionCard
            attempt={v2Attempt}
            isSubmitting={status === 'submitting'}
            lockedOptionId={lockedOptionId}
            onAnswer={handleV2Answer}
            onEventExpire={lifecycleHandlers.handleExpire}
            onRetryEventExpire={lifecycleHandlers.handleExpire}
            onRetryLockedAnswer={lifecycleHandlers.handleRetry}
            expiryRetryable={expiryRetryable}
            styles={styles}
          />
        </ScrollView>
      ) : null}

      {status === 'result' ? (
        <QuizResultsSection
          expectedUserId={useAuthStore.getState().user?.id ?? null}
          legacyResult={result}
          lifecycle={v2LifecycleStatus}
          music={music}
          musicPlayerPlayback={musicPlayerPlayback}
          styles={styles}
          terminalContext={terminalContext}
          v2Result={v2Result}
        />
      ) : null}

      <QuizGameplayAdFooter
        active={status === 'question' || status === 'submitting'}
      />

      <QuizGateModals dobGate={dobGate} usernameGate={usernameGate} />
    </View>
  );
}
