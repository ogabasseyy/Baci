import type { QuizEvent } from '@/services/quiz-types';

/** Countdown and status helpers for the quiz waiting room. */

function getRemainingMs(event: QuizEvent, offsetMs: number): number {
  if (!event.startsAt) return 0;
  const startsAtMs = Date.parse(event.startsAt);
  if (!Number.isFinite(startsAtMs)) return 0;
  return Math.max(0, startsAtMs - (Date.now() + offsetMs));
}

export function getRemainingSeconds(
  event: QuizEvent,
  offsetMs: number
): number {
  return Math.ceil(getRemainingMs(event, offsetMs) / 1_000);
}

export function isTerminal(status: QuizEvent['status']): boolean {
  return ['closed', 'completed', 'cancelled', 'finalizing'].includes(status);
}
