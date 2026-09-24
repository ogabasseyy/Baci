'use client';

import { useState } from 'react';
import { clampNumber, clampNumberInput } from './quiz-admin-actions';
import { formatQuizDuration } from './quiz-duration';

export function QuizDurationField({
  expectedPlaySeconds,
  maximumSeconds,
  minimumSeconds,
  mode,
  onDurationChange,
  totalDurationSeconds,
}: {
  expectedPlaySeconds: number;
  maximumSeconds: number | null;
  minimumSeconds: number;
  mode: 'test' | 'live';
  onDurationChange: (seconds: number | null) => void;
  totalDurationSeconds: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const maximumDurationSeconds = maximumSeconds ?? Number.MAX_SAFE_INTEGER;

  const resetToDefault = () => {
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
            min={minimumSeconds}
            max={maximumSeconds ?? undefined}
            type="number"
            value={inputValue}
            onBlur={() =>
              setInputValue(
                clampNumberInput(
                  inputValue,
                  minimumSeconds,
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
                  minimumSeconds,
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
            onClick={resetToDefault}
            type="button"
          >
            {mode === 'live'
              ? 'Use suggested window'
              : 'Use expected play time'}
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
