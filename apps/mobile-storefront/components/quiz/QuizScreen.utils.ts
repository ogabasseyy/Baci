import type { QuizEvent } from '@/services/quiz';
import { QuizServiceError } from '@/services/quiz-types';

export type QuizScreenStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'starting'
  | 'question'
  | 'submitting'
  | 'result'
  | 'error';

let fallbackLocale: string | undefined;

function getFallbackLocale() {
  fallbackLocale ??= Intl.DateTimeFormat().resolvedOptions().locale;
  return fallbackLocale;
}

function getGregorianDateKey(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function getZonedHour(date: Date, timeZone?: string): number {
  const hour = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  })
    .formatToParts(date)
    .find((part) => part.type === 'hour')?.value;
  return hour ? Number.parseInt(hour, 10) : Number.NaN;
}

export function formatTimeRange(
  event: QuizEvent,
  locale: string | undefined,
  fallbackMessage: string
): string {
  if (!event.startsAt || !event.endsAt) {
    return fallbackMessage;
  }

  const startDate = new Date(event.startsAt);
  const endDate = new Date(event.endsAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return fallbackMessage;
  }

  const resolvedLocale = locale || getFallbackLocale();
  const start = startDate.toLocaleTimeString(resolvedLocale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const end = endDate.toLocaleTimeString(resolvedLocale, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${start} - ${end}`;
}

export function getQuizErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (error instanceof QuizServiceError) {
    if (error.code === 'QUIZ_ROUTE_PROOF_REQUIRED') {
      return 'We could not verify this quiz session. Please try again.';
    }
    if (error.code === 'QUIZ_TEST_ACCESS_REQUIRED') {
      return 'This test quiz is only available to approved testers.';
    }
  }
  return error instanceof Error ? error.message : fallbackMessage;
}

export function getEventStartButtonText(
  eventStatus: QuizEvent['status'],
  isStarting: boolean,
  isResume = false
): string {
  if (eventStatus === 'scheduled') return 'Scheduled';
  if (['closed', 'completed', 'cancelled', 'finalizing'].includes(eventStatus))
    return eventStatus === 'cancelled' ? 'Cancelled' : 'Closed';
  if (isStarting) return 'Starting...';
  if (isResume) return 'Resume quiz';
  return 'Play for free';
}

export function formatQuizClock(
  value: string | null,
  locale?: string,
  timeZone?: string
): string {
  if (!value || Number.isNaN(Date.parse(value))) return 'Time not set';
  return new Date(value).toLocaleTimeString(locale || getFallbackLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}

export function getPrizeMomentLabel(
  event: QuizEvent,
  serverNow = new Date().toISOString(),
  _locale = 'en-CA'
): "Today's Prize" | "Tonight's Prize" | "Tomorrow's Prize" {
  void _locale;
  const now = new Date(serverNow);
  const start = event.startsAt ? new Date(event.startsAt) : now;
  if (Number.isNaN(now.getTime()) || Number.isNaN(start.getTime())) {
    return "Today's Prize";
  }
  let hour: number;
  let nowHour: number;
  let startsAfterToday: boolean;
  try {
    const dateKey = (date: Date) => getGregorianDateKey(date, event.timeZone);
    startsAfterToday = dateKey(start) > dateKey(now);
    hour = getZonedHour(start, event.timeZone);
    nowHour = getZonedHour(now, event.timeZone);
  } catch {
    return "Today's Prize";
  }

  if (startsAfterToday) return "Tomorrow's Prize";
  if (event.status === 'active' && nowHour >= 17) return "Tonight's Prize";
  return hour >= 17 ? "Tonight's Prize" : "Today's Prize";
}

export function formatRemainingTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function shouldShowEventList(status: QuizScreenStatus): boolean {
  return status === 'ready' || status === 'starting';
}

export function isQuizRecoveryCurrent(
  state: { selectedEventId: string | null; status: string },
  eventId?: string
): boolean {
  if (eventId) {
    if (state.status === 'ready') return true;
    return (
      state.selectedEventId === eventId &&
      ['question', 'submitting', 'result'].includes(state.status)
    );
  }
  return state.status === 'ready';
}

export function canPlayAnotherQuizAttempt(
  event: QuizEvent | undefined,
  serverNow?: string | null
): boolean {
  if (
    !event ||
    (event.maxAttempts ?? 1) <= 1 ||
    !['open', 'active'].includes(event.status)
  ) {
    return false;
  }
  if (!event.endsAt) return true;
  const endsAt = Date.parse(event.endsAt);
  if (Number.isNaN(endsAt)) return false;
  const authoritativeNow = serverNow ?? event.serverNow;
  if (!authoritativeNow) return true;
  const now = Date.parse(authoritativeNow);
  return !Number.isNaN(now) && endsAt > now;
}
