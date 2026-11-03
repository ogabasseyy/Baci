import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QuizPlanSummary } from './quiz-plan-summary';

describe('QuizPlanSummary', () => {
  it('distinguishes expected play from the universal close', () => {
    render(
      <QuizPlanSummary
        closesAt="9:05 AM"
        questionCount={20}
        timePerQuestionSeconds={10}
      />
    );
    expect(screen.getByText(/Expected play: 3m 20s/)).toBeInTheDocument();
    expect(screen.getByText(/Universal close: 9:05 AM/)).toBeInTheDocument();
  });

  it('separates the close time from the late-player note with a full stop', () => {
    render(
      <QuizPlanSummary
        closesAt="After 30m"
        questionCount={2}
        timePerQuestionSeconds={10}
      />
    );
    expect(
      screen.getByText(
        'Universal close: After 30m. Late players get only the time remaining.'
      )
    ).toBeInTheDocument();
  });
});
