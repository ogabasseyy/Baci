import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { clampNumberInput } from './quiz-admin-actions';

interface QuizAuthoringTimingFieldsProps {
  timingKind: 'immediate' | 'scheduled';
  onTimingKindChange: (timingKind: 'immediate' | 'scheduled') => void;
  windowMinutes: string;
  onWindowMinutesChange: (value: string) => void;
  scheduledStart: string;
  onScheduledStartChange: (value: string) => void;
  scheduledEnd: string;
  onScheduledEndChange: (value: string) => void;
}

/**
 * Launch timing inputs: the immediate live window, or the scheduled
 * universal start/end wall clocks in the launch policy zone. The parent
 * owns syncing and validation; this component only edits.
 */
export function QuizAuthoringTimingFields({
  timingKind,
  onTimingKindChange,
  windowMinutes,
  onWindowMinutesChange,
  scheduledStart,
  onScheduledStartChange,
  scheduledEnd,
  onScheduledEndChange,
}: QuizAuthoringTimingFieldsProps) {
  return (
    <>
      <label className="grid gap-2 text-sm font-medium">
        Launch timing
        <select
          className="h-11 rounded-md border bg-background px-3"
          value={timingKind}
          onChange={(event) =>
            onTimingKindChange(
              event.target.value === 'scheduled' ? 'scheduled' : 'immediate'
            )
          }
        >
          <option value="immediate">Launch immediately after review</option>
          <option value="scheduled">Schedule a universal start and end</option>
        </select>
      </label>
      {timingKind === 'immediate' ? (
        <label className="grid gap-2 text-sm font-medium">
          Universal live window (minutes)
          <input
            className="h-11 rounded-md border bg-background px-3"
            min={1}
            max={120}
            type="number"
            value={windowMinutes}
            onBlur={() =>
              onWindowMinutesChange(clampNumberInput(windowMinutes, 1, 120))
            }
            onChange={(event) => onWindowMinutesChange(event.target.value)}
          />
        </label>
      ) : (
        <>
          <label className="grid gap-2 text-sm font-medium">
            Scheduled start ({QUIZ_DEFAULT_TIME_ZONE})
            <input
              className="h-11 rounded-md border bg-background px-3"
              type="datetime-local"
              value={scheduledStart}
              onChange={(event) => onScheduledStartChange(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Universal end ({QUIZ_DEFAULT_TIME_ZONE})
            <input
              className="h-11 rounded-md border bg-background px-3"
              type="datetime-local"
              value={scheduledEnd}
              onChange={(event) => onScheduledEndChange(event.target.value)}
            />
          </label>
        </>
      )}
    </>
  );
}
