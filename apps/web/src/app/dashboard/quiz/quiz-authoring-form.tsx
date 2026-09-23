'use client';

import { Loader2, Sparkles } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import type { QuizPrizeProduct } from '@/schemas/quiz-prize-product';
import {
  clampNumber,
  clampNumberInput,
  isQuizDifficulty,
  type QuizDraftConfiguration,
} from './quiz-admin-actions';
import { resolveQuizAuthoringClosesAt } from './quiz-authoring-close-preview';
import { QuizAuthoringTimingFields } from './quiz-authoring-timing-fields';
import { isQuizAuthoringWindowAllowed } from './quiz-authoring-window-allowed';
import { suggestedQuizDuration } from './quiz-duration';
import { QuizPlanSummary } from './quiz-plan-summary';
import { QuizPrizeProductPicker } from './quiz-prize-product-picker';
import { QuizTopicInput } from './quiz-topic-input';
import { useQuizAuthoringClock } from './use-quiz-authoring-clock';
import { useQuizAuthoringSchedule } from './use-quiz-authoring-schedule';
import { useQuizAuthoringWindowSync } from './use-quiz-authoring-window-sync';

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
  const [requestedWindowMinutes, setWindowMinutes] = useState<string | null>(
    null
  );
  const [difficulty, setDifficulty] = useState<'easy' | 'standard' | 'hard'>(
    'standard'
  );
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [timingKind, setTimingKind] = useState<'immediate' | 'scheduled'>(
    'scheduled'
  );
  const { scheduledEnd, scheduledStart, setScheduledEnd, setScheduledStart } =
    useQuizAuthoringSchedule(Date.now());
  // The admin owns Universal end once they edit it; until then it tracks the
  // scheduled start plus the expected play time from the quiz summary.
  const [endTouched, setEndTouched] = useState(false);
  const questionCount = topics.length * clampNumber(Number(perTopic), 1, 20);
  const timePerQuestionSeconds = clampNumber(Number(time), 5, 60);
  const suggestedSeconds = suggestedQuizDuration(
    mode,
    questionCount,
    timePerQuestionSeconds
  );
  const windowMinutes = requestedWindowMinutes ?? String(suggestedSeconds / 60);
  useQuizAuthoringWindowSync({
    endTouched,
    mode,
    questionCount,
    scheduledStart,
    setScheduledEnd,
    timePerQuestionSeconds,
  });
  const closesAt = resolveQuizAuthoringClosesAt({
    scheduledEnd,
    timingKind,
    windowMinutes,
  });
  // Generation requires an interval activation will accept: a manually
  // shrunk window outside the launch bounds wastes the AI draft request.
  // Validity reads Date.now() fresh every render; the clock tick rerenders
  // anyway, so when the scheduled start passes the button disables and the
  // timing alert appears without any further interaction.
  const retickClock = useQuizAuthoringClock();
  const liveWindowMinutes = Number(windowMinutes);
  const timingValid = isQuizAuthoringWindowAllowed({
    liveWindowMinutes,
    mode,
    questionCount,
    scheduledEnd,
    scheduledStart,
    timePerQuestionSeconds,
    timingKind,
  });
  const canSubmit =
    !disabled &&
    !isGenerating &&
    timingValid &&
    Boolean(title.trim() && topics.length && prizeProduct?.available);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prizeProduct || !canSubmit) return;
    // Render-time validation goes stale while the page sits open; recheck
    // the current clock before spending the AI request on an expired start.
    if (
      !isQuizAuthoringWindowAllowed({
        liveWindowMinutes,
        mode,
        nowMs: Date.now(),
        questionCount,
        scheduledEnd,
        scheduledStart,
        timePerQuestionSeconds,
        timingKind,
      })
    ) {
      // The start passed inside the tick window with the button still
      // enabled: rerender so validity re-reads the clock and the admin is
      // told to choose a future start instead of clicking into silence.
      retickClock();
      return;
    }
    onGenerate({
      difficulty,
      endTouched,
      liveWindowMinutes,
      windowTouched: requestedWindowMinutes !== null,
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
          <QuizAuthoringTimingFields
            timingKind={timingKind}
            onTimingKindChange={setTimingKind}
            windowMinutes={windowMinutes}
            onWindowMinutesChange={setWindowMinutes}
            scheduledStart={scheduledStart}
            onScheduledStartChange={setScheduledStart}
            scheduledEnd={scheduledEnd}
            onScheduledEndChange={(value) => {
              setEndTouched(true);
              setScheduledEnd(value);
            }}
          />
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
          Universal end must be after the scheduled start and inside the allowed
          window for this quiz.
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
