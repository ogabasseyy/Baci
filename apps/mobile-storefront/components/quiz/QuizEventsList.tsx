import { QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS } from '@baci/shared/constants';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type { QuizEvent } from '@/services/quiz-types';
import { GadgetPatternBackground } from '../storefront/GadgetPatternBackground';
import type { createQuizLobbyStyles } from './QuizLobby.styles';
import { QuizLobbyEventCard } from './QuizLobbyEventCard';
import { QuizMissionHero } from './QuizMissionHero';
import { QuizRulesModal } from './QuizRulesModal';
import { QuizWaitingRoom } from './QuizWaitingRoom';

type QuizStyles = ReturnType<typeof createQuizLobbyStyles>;

interface QuizEventsListProps {
  events: QuizEvent[];
  fetchEvents?: () => Promise<QuizEvent[]>;
  isStarting: boolean;
  isSignedIn?: boolean;
  locale?: string;
  onEventsUpdated?: (events: QuizEvent[]) => void;
  onRefresh?: () => Promise<void>;
  onStart: (eventId: string, termsAccepted?: true) => void;
  onResume?: (eventId: string) => void;
  onSignIn?: () => void;
  resumeEventId?: string | null;
  serverNow?: string;
  styles: QuizStyles;
}

type RulesState = {
  action: 'start' | 'waiting';
  event: QuizEvent;
  requiresAcceptance: boolean;
} | null;

export function QuizEventsList({
  events,
  fetchEvents,
  isStarting,
  isSignedIn = true,
  locale,
  onEventsUpdated,
  onRefresh,
  onStart,
  onResume,
  onSignIn,
  resumeEventId,
  serverNow,
  styles,
}: QuizEventsListProps) {
  const [rules, setRules] = useState<RulesState>(null);
  const [waitingEvent, setWaitingEvent] = useState<QuizEvent | null>(null);
  const [displayEvents, setDisplayEvents] = useState(events);
  const { colors, isDark } = useTheme();

  useEffect(() => {
    setDisplayEvents(events);
  }, [events]);

  if (waitingEvent) {
    return (
      <QuizWaitingRoom
        event={waitingEvent}
        locale={locale}
        onEventsUpdated={onEventsUpdated}
        onExit={() => setWaitingEvent(null)}
        onStart={(eventId, termsAccepted) => {
          setWaitingEvent(null);
          onStart(eventId, termsAccepted);
        }}
        refresh={async () => {
          if (!fetchEvents) return displayEvents;
          const latest = await fetchEvents();
          setDisplayEvents(latest);
          return latest;
        }}
      />
    );
  }

  return (
    <View style={styles.eventsList}>
      <View
        style={styles.patternBackground}
        testID="quiz-gadget-pattern-background"
      >
        <GadgetPatternBackground
          backgroundColor={colors.background}
          colorScheme={isDark ? 'dark' : 'light'}
          height={1100}
          opacity={isDark ? 0.1 : 0.09}
        />
      </View>
      <FlatList
        accessibilityLabel="Available quiz events"
        contentContainerStyle={styles.eventsListContent}
        data={displayEvents}
        extraData={`${isStarting}:${resumeEventId ?? ''}:${serverNow ?? ''}`}
        keyExtractor={(event) => event.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>
              {isSignedIn
                ? 'No quiz events available.'
                : 'Sign in to see available quizzes.'}
            </Text>
            <Text style={styles.emptyStateText}>
              {isSignedIn
                ? 'Check back soon for the next chance to play.'
                : 'Create an account or sign in to join the next SuperQuiz.'}
            </Text>
            {!isSignedIn && onSignIn ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in to play"
                onPress={onSignIn}
              >
                <Text style={styles.emptyStateText}>Sign in to play</Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListHeaderComponent={
          <>
            <QuizMissionHero />
            {isSignedIn &&
            resumeEventId &&
            onResume &&
            !displayEvents.some((event) => event.id === resumeEventId) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Recover quiz attempt"
                accessibilityState={{ disabled: isStarting }}
                disabled={isStarting}
                onPress={() => onResume(resumeEventId)}
                style={styles.primaryButtonBox}
              >
                <Text style={styles.primaryButtonText}>
                  Recover quiz attempt
                </Text>
              </Pressable>
            ) : null}
          </>
        }
        onRefresh={onRefresh}
        refreshing={false}
        renderItem={({ item }) => (
          <QuizLobbyEventCard
            event={item}
            isSignedIn={isSignedIn}
            isResume={Boolean(onResume) && resumeEventId === item.id}
            isStarting={isStarting}
            locale={locale}
            onOpenRules={(requiresAcceptance) =>
              setRules({ action: 'start', event: item, requiresAcceptance })
            }
            onEnterWaitingRoom={() =>
              setRules({
                action: 'waiting',
                event: item,
                requiresAcceptance: true,
              })
            }
            onExpire={onRefresh}
            onResume={() => onResume?.(item.id)}
            onSignIn={onSignIn}
            serverNow={item.serverNow ?? serverNow}
            styles={styles}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      {rules ? (
        <QuizRulesModal
          eventTitle={rules.event.title}
          onClose={() => setRules(null)}
          onConfirm={() => {
            setRules(null);
            if (rules.action === 'waiting') {
              setWaitingEvent(rules.event);
            } else {
              onStart(rules.event.id, true);
            }
          }}
          requiresAcceptance={rules.requiresAcceptance}
          timePerQuestionSeconds={
            rules.event.timePerQuestionSeconds ??
            QUIZ_DEFAULT_TIME_PER_QUESTION_SECONDS
          }
          visible
        />
      ) : null}
    </View>
  );
}
