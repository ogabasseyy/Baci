import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizLaunchDialog } from './quiz-launch-dialog';

const configuration = {
  difficulty: 'standard' as const,
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
  scheduledEnd: '',
  scheduledStart: '',
  timePerQuestionSeconds: 10,
  timingKind: 'immediate' as const,
  title: 'Quiz',
  topics: ['Phones'],
};

describe('QuizLaunchDialog', () => {
  it('summarizes and confirms the launch', async () => {
    const onConfirm = vi.fn();
    const review = { questions: [{ correctOptionId: 'a', position: 1 }] };
    const user = userEvent.setup();
    render(
      <QuizLaunchDialog
        answerKeyReview={review}
        configuration={configuration}
        isLaunching={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/10 seconds per question/)
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: /launch quiz/i })
    );
    expect(onConfirm).toHaveBeenCalledWith(review);
  });

  it('formats the scheduled window from Lagos-derived instants with the policy zone labeled', () => {
    // Regression: the offset-free field values are Lagos wall clocks, so a
    // browser-local parse would show an admin outside Africa/Lagos the
    // wrong activation time. 10:00 entered in the fields means 10:00 Lagos
    // (09:00 UTC), which the summary must reflect with the zone labeled.
    render(
      <QuizLaunchDialog
        answerKeyReview={{ questions: [] }}
        configuration={{
          ...configuration,
          scheduledEnd: '2026-10-01T12:00',
          scheduledStart: '2026-10-01T10:00',
          timingKind: 'scheduled',
        }}
        isLaunching={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    const expected = `${new Date('2026-10-01T09:00:00.000Z').toLocaleString(undefined, { timeZone: 'Africa/Lagos' })} to ${new Date('2026-10-01T11:00:00.000Z').toLocaleString(undefined, { timeZone: 'Africa/Lagos' })} (Africa/Lagos)`;
    expect(within(dialog).getByText(expected)).toBeInTheDocument();
  });

  it('shows an activation failure inside the dialog', () => {
    render(
      <QuizLaunchDialog
        activationError="Launch service unavailable"
        answerKeyReview={{ questions: [] }}
        configuration={configuration}
        isLaunching={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      within(screen.getByRole('dialog')).getByRole('alert')
    ).toHaveTextContent('Launch service unavailable');
  });

  it('requires documented regulatory evidence for a live launch', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <QuizLaunchDialog
        answerKeyReview={{ questions: [{ correctOptionId: 'a', position: 1 }] }}
        configuration={{ ...configuration, mode: 'live' }}
        isLaunching={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const launch = screen.getByRole('button', { name: /launch quiz/i });
    expect(launch).toBeDisabled();
    await user.type(
      screen.getByLabelText('Evidence reference'),
      'Free-entry rules and counsel note 2026-08'
    );
    await user.click(launch);

    expect(onConfirm).toHaveBeenCalledWith(expect.any(Object), {
      basis: 'free_skill_competition',
      evidenceReference: 'Free-entry rules and counsel note 2026-08',
      jurisdiction: 'NG-LA',
    });
  });
});
