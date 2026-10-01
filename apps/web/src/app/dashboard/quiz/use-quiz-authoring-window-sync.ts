import { useEffect } from 'react';
import { resyncQuizAuthoringScheduledEnd } from './quiz-authoring-scheduled-end';

export interface QuizAuthoringWindowSyncInput {
  endTouched: boolean;
  mode: 'test' | 'live';
  questionCount: number;
  scheduledStart: string;
  setScheduledEnd: (updater: (current: string) => string) => void;
  timePerQuestionSeconds: number;
}

/**
 * Keep the Universal end synced to the start until the merchant edits it.
 * All values are launch-policy-zone (Africa/Lagos) wall clocks: activation
 * interprets the inputs in that zone, so browser-local defaults would shift
 * the window for admins elsewhere. Rounds the synced end up to minute
 * precision because datetime-local inputs drop seconds — a 70-second play
 * window must not sync an end only 60 seconds out.
 */
export function useQuizAuthoringWindowSync({
  endTouched,
  mode,
  questionCount,
  scheduledStart,
  setScheduledEnd,
  timePerQuestionSeconds,
}: QuizAuthoringWindowSyncInput): void {
  useEffect(() => {
    if (endTouched) return;
    const synced = resyncQuizAuthoringScheduledEnd({
      mode,
      questionCount,
      scheduledStart,
      timePerQuestionSeconds,
    });
    if (!synced) return;
    setScheduledEnd((current) => (current === synced ? current : synced));
  }, [
    endTouched,
    mode,
    questionCount,
    scheduledStart,
    setScheduledEnd,
    timePerQuestionSeconds,
  ]);
}
