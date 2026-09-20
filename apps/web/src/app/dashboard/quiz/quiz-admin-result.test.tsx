import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizAdminResult } from './quiz-admin-result';

const configuration = {
  difficulty: 'standard' as const,
  endTouched: false,
  liveWindowMinutes: 5,
  mode: 'test' as const,
  prizeProduct: {
    available: true,
    condition: 'new',
    defaultVariantId: null,
    effectiveStock: 1,
    hasVariants: false,
    id: '55555555-5555-4555-8555-555555555555',
    imageUrl: null,
    manageStock: true,
    name: 'iPhone XR',
    price: 1,
    requiresVariantSelection: false,
    selectionId: 'prize:product',
    variantId: null,
    variantLabel: null,
  },
  questionCountPerTopic: 1,
  scheduledEnd: '2026-08-05T09:05',
  scheduledStart: '2026-08-05T09:00',
  timePerQuestionSeconds: 10,
  timingKind: 'immediate' as const,
  title: 'Daily Phone Quiz',
  topics: ['Android buying advice'],
};

function draftResult() {
  return {
    event: {
      id: 'event-1',
      slug: 'daily-phone-quiz',
      status: 'draft',
      title: 'Daily Phone Quiz',
    },
    questions: [
      {
        correctOptionId: 'a',
        difficulty: 'standard' as const,
        explanation: 'Newer Android phones ship with USB-C.',
        options: [
          { id: 'a', label: 'USB-C' },
          { id: 'b', label: 'Micro-USB' },
        ],
        prompt: 'Which charging port is common on newer Android phones?',
        topic: 'Android buying advice',
      },
    ],
  };
}

describe('QuizAdminResult', () => {
  it('shows the AI-marked correct answer and explanation for a draft', () => {
    render(
      <QuizAdminResult configuration={configuration} result={draftResult()} />
    );

    expect(screen.getByText('Draft saved')).toBeInTheDocument();
    expect(
      screen.getByText('Which charging port is common on newer Android phones?')
    ).toBeInTheDocument();
    expect(screen.getAllByText('Correct').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Newer Android phones ship with USB-C\./)
    ).toBeInTheDocument();
  });

  it('resets the review confirmation when a NEW draft is rendered', async () => {
    // The confirmation is per draft: a checkbox ticked for draft A must not
    // pre-authorize opening a subsequently generated draft B.
    const user = userEvent.setup();
    const { rerender } = render(
      <QuizAdminResult
        configuration={configuration}
        onActivate={vi.fn()}
        result={draftResult()}
      />
    );

    await user.click(
      screen.getByRole('checkbox', { name: /reviewed every correct answer/i })
    );
    expect(screen.getByRole('button', { name: /launch quiz/i })).toBeEnabled();

    const nextDraft = draftResult();
    nextDraft.event = { ...nextDraft.event, id: 'event-2', title: 'New Draft' };
    rerender(
      <QuizAdminResult
        configuration={configuration}
        onActivate={vi.fn()}
        result={nextDraft}
      />
    );

    expect(
      screen.getByRole('checkbox', { name: /reviewed every correct answer/i })
    ).not.toBeChecked();
    expect(screen.getByRole('button', { name: /launch quiz/i })).toBeDisabled();
  });

  it('gates the open action behind an explicit review confirmation', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();

    render(
      <QuizAdminResult
        configuration={configuration}
        onActivate={onActivate}
        result={draftResult()}
      />
    );

    const openButton = screen.getByRole('button', { name: /launch quiz/i });
    expect(openButton).toBeDisabled();

    await user.click(
      screen.getByRole('checkbox', { name: /reviewed every correct answer/i })
    );
    expect(openButton).toBeEnabled();

    await user.click(openButton);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /launch quiz/i,
      })
    );
    expect(onActivate).toHaveBeenCalledWith(
      { questions: [{ correctOptionId: 'a', position: 1 }] },
      undefined
    );
  });

  it('renders a live state without the open action once active', () => {
    render(
      <QuizAdminResult
        configuration={configuration}
        result={{
          ...draftResult(),
          event: { ...draftResult().event, status: 'active' },
        }}
      />
    );

    expect(screen.getByText('Quiz launched')).toBeInTheDocument();
    expect(screen.getByText('Status: active')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /launch quiz/i })
    ).not.toBeInTheDocument();
  });

  it('closes the confirmation dialog when the quiz becomes launched', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <QuizAdminResult
        configuration={configuration}
        onActivate={vi.fn()}
        result={draftResult()}
      />
    );
    await user.click(
      screen.getByRole('checkbox', { name: /reviewed every correct answer/i })
    );
    await user.click(screen.getByRole('button', { name: /launch quiz/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(
      <QuizAdminResult
        configuration={configuration}
        onActivate={vi.fn()}
        result={{
          ...draftResult(),
          event: { ...draftResult().event, status: 'active' },
        }}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks launch when the generated count outgrows the window', async () => {
    // Regression: activation validates the window against the generated
    // questions, so an immediate window (or untouched-by-resync edited end)
    // sized for the requested count must not reach the launch action.
    const user = userEvent.setup();
    const draft = draftResult();
    const manyQuestions = Array.from({ length: 20 }, (_, index) => ({
      ...draft.questions[0],
      prompt: `Question ${index + 1}`,
    }));
    render(
      <QuizAdminResult
        configuration={{
          ...configuration,
          liveWindowMinutes: 1,
          mode: 'live',
          timingKind: 'immediate',
        }}
        onActivate={vi.fn()}
        result={{ ...draft, questions: manyQuestions }}
      />
    );

    expect(
      screen.getByText(/generated questions do not fit/i)
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('checkbox', { name: /reviewed every correct answer/i })
    );
    expect(screen.getByRole('button', { name: /launch quiz/i })).toBeDisabled();
  });
});
