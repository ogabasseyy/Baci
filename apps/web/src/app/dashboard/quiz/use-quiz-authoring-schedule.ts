import type { Dispatch, SetStateAction } from 'react';
import { useState } from 'react';
import { defaultQuizAuthoringSchedule } from './quiz-authoring-schedule-defaults';

/**
 * Schedule input state with launch-policy-zone defaults. The admin owns the
 * Universal end once they edit it; until then it tracks the start via
 * useQuizAuthoringWindowSync.
 */
export function useQuizAuthoringSchedule(nowMs: number): {
  scheduledEnd: string;
  scheduledStart: string;
  setScheduledEnd: Dispatch<SetStateAction<string>>;
  setScheduledStart: Dispatch<SetStateAction<string>>;
} {
  const [scheduleDefaults] = useState(() =>
    defaultQuizAuthoringSchedule(nowMs)
  );
  const [scheduledStart, setScheduledStart] = useState(
    scheduleDefaults.scheduledStart
  );
  const [scheduledEnd, setScheduledEnd] = useState(
    scheduleDefaults.scheduledEnd
  );
  return { scheduledEnd, scheduledStart, setScheduledEnd, setScheduledStart };
}
