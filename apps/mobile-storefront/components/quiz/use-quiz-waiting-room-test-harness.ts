import type { QuizEvent } from '@/services/quiz-types';

// Shared builders for the waiting-room suites (core, interstitial request,
// interstitial ownership, start hold). The interstitial module mock lives in
// each suite file: jest.mock hoisting is per-file, so a shared mock would
// register after the suite's static import of the mocked module.
export const event = (overrides: Partial<QuizEvent> = {}): QuizEvent => ({
  endsAt: '2026-08-23T12:10:00.000Z',
  id: 'event-1',
  prizeName: 'Phone',
  questionCount: 10,
  startsAt: '2026-08-23T12:00:00.000Z',
  status: 'scheduled',
  title: 'Noon Quiz',
  serverNow: '2026-08-23T11:59:00.000Z',
  timePerQuestionSeconds: 10,
  ...overrides,
});

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
