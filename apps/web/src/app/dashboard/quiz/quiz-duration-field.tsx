'use client';

import { useState } from 'react';
import { clampNumber, clampNumberInput } from './quiz-admin-actions';
import { formatQuizDuration } from './quiz-duration';

const MAX_TOTAL_DURATION_SECONDS = 120 * 60;

export function QuizDurationField({
  expectedPlaySeconds,
  onDurationChange,
  totalDurationSeconds,
}: {
  expectedPlaySeconds: number;
  onDurationChange: (seconds: number | null) => void;
  totalDurationSeconds: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const maximumDurationSeconds = Math.max(
    MAX_TOTAL_DURATION_SECONDS,
    expectedPlaySeconds
  );

  const resetToExpectedPlay = () => {
    setInputValue('');
    setIsExpanded(false);
    onDurationChange(null);
  };

  return (
    <div className="grid gap-2 text-sm font-medium">
      <div className="flex items-center justify-between gap-3">
        <span>Total quiz duration</span>
        {!isExpanded ? (
          <button
            className="text-xs font-semibold text-primary underline underline-offset-4"
            onClick={() => {
              setInputValue(String(totalDurationSeconds));
              setIsExpanded(true);
            }}
            type="button"
          >
            Extend play time
          </button>
        ) : null}
      </div>
      {isExpanded ? (
        <>
          <input
            aria-label="Total quiz duration (seconds)"
            className="h-11 rounded-md border bg-background px-3"
            min={expectedPlaySeconds}
            max={maximumDurationSeconds}
            type="number"
            value={inputValue}
            onBlur={() =>
              setInputValue(
                clampNumberInput(
                  inputValue,
                  expectedPlaySeconds,
                  maximumDurationSeconds
                )
              )
            }
            onChange={(event) => {
              const nextValue = event.target.value;
              setInputValue(nextValue);
              onDurationChange(
                clampNumber(
                  Number(nextValue),
                  expectedPlaySeconds,
                  maximumDurationSeconds
                )
              );
            }}
          />
          <p className="text-xs font-normal text-muted-foreground">
            Expected play time is {formatQuizDuration(expectedPlaySeconds)}.
            Late players get only the time remaining.
          </p>
          <button
            className="w-fit text-xs font-semibold text-muted-foreground underline underline-offset-4"
            onClick={resetToExpectedPlay}
            type="button"
          >
            Use expected play time
          </button>
        </>
      ) : (
        <p className="rounded-md border bg-background px-3 py-2 font-semibold">
          {formatQuizDuration(totalDurationSeconds)}
        </p>
      )}
    </div>
  );
}
