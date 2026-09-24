import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizDurationField } from './quiz-duration-field';

describe('QuizDurationField', () => {
  it('starts at expected play time and emits an extension', async () => {
    const onDurationChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuizDurationField
        expectedPlaySeconds={70}
        onDurationChange={onDurationChange}
        totalDurationSeconds={70}
      />
    );

    expect(screen.getByText('1m 10s')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /extend play time/i }));
    const input = screen.getByLabelText(/total quiz duration \(seconds\)/i);
    await user.clear(input);
    await user.type(input, '90');

    expect(onDurationChange).toHaveBeenLastCalledWith(90);
  });

  it('clears the override when the merchant restores expected play time', async () => {
    const onDurationChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuizDurationField
        expectedPlaySeconds={70}
        onDurationChange={onDurationChange}
        totalDurationSeconds={120}
      />
    );

    await user.click(screen.getByRole('button', { name: /extend play time/i }));
    await user.click(
      screen.getByRole('button', { name: /use expected play time/i })
    );

    expect(onDurationChange).toHaveBeenLastCalledWith(null);
  });
});
