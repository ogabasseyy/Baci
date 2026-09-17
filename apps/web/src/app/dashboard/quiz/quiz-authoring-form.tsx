'use client';

import { Loader2, Sparkles } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import type { QuizPrizeProduct } from '@/schemas/quiz-prize-product';
import {
  clampNumber,
  clampNumberInput,
  isQuizDifficulty,
} from './quiz-admin-actions';
import { QuizPlanSummary } from './quiz-plan-summary';
import { QuizPrizeProductPicker } from './quiz-prize-product-picker';
import { QuizTopicInput } from './quiz-topic-input';

export type QuizDraftConfiguration = {
  difficulty: 'easy' | 'standard' | 'hard';
  liveWindowMinutes: number;
  mode: 'test' | 'live';
  prizeProduct: QuizPrizeProduct;
  questionCountPerTopic: number;
  scheduledEnd: string;
  scheduledStart: string;
  timePerQuestionSeconds: number;
  timingKind: 'immediate' | 'scheduled';
  title: string;
  topics: string[];
};

function localDatetime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function QuizAuthoringForm({
  disabled,
  initialError,
  initialProducts,
  isGenerating,
  onGenerate,
}: {
  disabled: boolean;
  initialError?: string | null;
  initialProducts: QuizPrizeProduct[];
  isGenerating: boolean;
  onGenerate: (configuration: QuizDraftConfiguration) => void;
}) {
  const now = new Date();
  const [title, setTitle] = useState('Daily Phone Quiz');
  const [topics, setTopics] = useState([
    'iPhone buying advice',
    'Android buying advice',
  ]);
  const [prizeProduct, setPrizeProduct] = useState<QuizPrizeProduct | null>(
    initialProducts.find(
      (product) => product.available && !product.requiresVariantSelection
    ) ?? null
  );
  const [time, setTime] = useState('10');
  const [perTopic, setPerTopic] = useState('1');
  const [windowMinutes, setWindowMinutes] = useState('5');
  const [difficulty, setDifficulty] = useState<'easy' | 'standard' | 'hard'>(
    'standard'
  );
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [timingKind, setTimingKind] = useState<'immediate' | 'scheduled'>(
    'scheduled'
  );
  const [scheduledStart, setScheduledStart] = useState(
    localDatetime(new Date(now.getTime() + 3_600_000))
  );
  const [scheduledEnd, setScheduledEnd] = useState(
    localDatetime(new Date(now.getTime() + 3_900_000))
  );
  // The admin owns Universal end once they edit it; until then it tracks the
  // scheduled start plus the expected play time from the quiz summary.
  const [endTouched, setEndTouched] = useState(false);
  const questionCount = topics.length * clampNumber(Number(perTopic), 1, 20);
  const timePerQuestionSeconds = clampNumber(Number(time), 5, 60);
  // Floor keeps the defaulted end after the start when no questions exist yet.
  const expectedPlaySeconds = Math.max(
    questionCount * timePerQuestionSeconds,
    60
  );
  useEffect(() => {
    if (endTouched) return;
    const startMs = Date.parse(scheduledStart);
    if (!Number.isFinite(startMs)) return;
    const synced = localDatetime(
      new Date(startMs + expectedPlaySeconds * 1000)
    );
    setScheduledEnd((current) => (current === synced ? current : synced));
  }, [endTouched, expectedPlaySeconds, scheduledStart]);
  const closesAt =
    timingKind === 'scheduled' && scheduledEnd
      ? new Date(scheduledEnd).toLocaleString()
      : `About ${windowMinutes} minute${windowMinutes === '1' ? '' : 's'} after launch`;
  const timingValid =
    timingKind === 'immediate' ||
    (Boolean(scheduledStart && scheduledEnd) &&
      Date.parse(scheduledEnd) > Date.parse(scheduledStart));
  const canSubmit =
    !disabled &&
    !isGenerating &&
    timingValid &&
    Boolean(title.trim() && topics.length && prizeProduct?.available);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prizeProduct || !canSubmit) return;
    onGenerate({
      difficulty,
      liveWindowMinutes: clampNumber(Number(windowMinutes), 1, 120),
      mode,
      prizeProduct,
      questionCountPerTopic: clampNumber(Number(perTopic), 1, 20),
      scheduledEnd,
      scheduledStart,
      timePerQuestionSeconds: clampNumber(Number(time), 5, 60),
      timingKind,
      title: title.trim(),
      topics,
    });
  };

  return (
    <form className="rounded-lg border bg-card p-5 shadow-sm" onSubmit={submit}>
      <fieldset disabled={disabled || isGenerating}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            Quiz title
            <input
              className="h-11 rounded-md border bg-background px-3 text-sm"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <QuizPrizeProductPicker
            disabled={disabled}
            initialError={initialError}
            initialProducts={initialProducts}
            onSelect={setPrizeProduct}
            selectedProduct={prizeProduct}
          />
          <label className="grid gap-2 text-sm font-medium">
            Mode
            <select
              className="h-11 rounded-md border bg-background px-3"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value === 'live' ? 'live' : 'test')
              }
            >
              <option value="test">
                Test — private rehearsal, no prize awarded
              </option>
              <option value="live">
                Live — production prize and compliance gates apply
              </option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Difficulty
            <select
              className="h-11 rounded-md border bg-background px-3"
              value={difficulty}
              onChange={(event) => {
                if (isQuizDifficulty(event.target.value))
                  setDifficulty(event.target.value);
              }}
            >
              <option value="easy">Easy</option>
              <option value="standard">Standard</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Time per question (seconds)
            <input
              className="h-11 rounded-md border bg-background px-3"
              min={5}
              max={60}
              type="number"
              value={time}
              onBlur={() => setTime(clampNumberInput(time, 5, 60))}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Questions per topic
            <input
              className="h-11 rounded-md border bg-background px-3"
              min={1}
              max={20}
              type="number"
              value={perTopic}
              onBlur={() => setPerTopic(clampNumberInput(perTopic, 1, 20))}
              onChange={(event) => setPerTopic(event.target.value)}
            />
          </label>
          <QuizTopicInput
            disabled={disabled}
            onChange={setTopics}
            topics={topics}
          />
          <label className="grid gap-2 text-sm font-medium">
            Launch timing
            <select
              className="h-11 rounded-md border bg-background px-3"
              value={timingKind}
              onChange={(event) =>
                setTimingKind(
                  event.target.value === 'scheduled' ? 'scheduled' : 'immediate'
                )
              }
            >
              <option value="immediate">Launch immediately after review</option>
              <option value="scheduled">
                Schedule a universal start and end
              </option>
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
                  setWindowMinutes(clampNumberInput(windowMinutes, 1, 120))
                }
                onChange={(event) => setWindowMinutes(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="grid gap-2 text-sm font-medium">
                Scheduled start
                <input
                  className="h-11 rounded-md border bg-background px-3"
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(event) => setScheduledStart(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Universal end
                <input
                  className="h-11 rounded-md border bg-background px-3"
                  type="datetime-local"
                  value={scheduledEnd}
                  onChange={(event) => {
                    setEndTouched(true);
                    setScheduledEnd(event.target.value);
                  }}
                />
              </label>
            </>
          )}
        </div>
      </fieldset>
      <div className="mt-5">
        <QuizPlanSummary
          closesAt={closesAt}
          questionCount={questionCount}
          timePerQuestionSeconds={timePerQuestionSeconds}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Test mode is safe for invited testers and never awards the product. Live
        mode stays locked until production prize approval and compliance checks
        pass.
      </p>
      {!timingValid ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          Universal end must be after the scheduled start.
        </p>
      ) : null}
      <button
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        disabled={!canSubmit}
        type="submit"
      >
        {isGenerating ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        Generate draft
      </button>
    </form>
  );
}
