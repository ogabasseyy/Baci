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
        maximumSeconds={190}
        minimumSeconds={70}
        mode="test"
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
        maximumSeconds={190}
        minimumSeconds={70}
        mode="test"
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

  it('clamps live extensions to the shared window bounds', async () => {
    const onDurationChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuizDurationField
        expectedPlaySeconds={20}
        maximumSeconds={140}
        minimumSeconds={50}
        mode="live"
        onDurationChange={onDurationChange}
        totalDurationSeconds={120}
      />
    );

    await user.click(screen.getByRole('button', { name: /extend play time/i }));
    const input = screen.getByLabelText(/total quiz duration \(seconds\)/i);
    expect(input).toHaveAttribute('min', '50');
    expect(input).toHaveAttribute('max', '140');
    await user.clear(input);
    await user.type(input, '10');

    expect(onDurationChange).toHaveBeenLastCalledWith(50);
    await user.click(
      screen.getByRole('button', { name: /use suggested window/i })
    );
    expect(onDurationChange).toHaveBeenLastCalledWith(null);
  });

  it('synchronizes the input when its bounds change', async () => {
    const onDurationChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <QuizDurationField
        expectedPlaySeconds={20}
        maximumSeconds={null}
        minimumSeconds={10}
        mode="test"
        onDurationChange={onDurationChange}
        totalDurationSeconds={20}
      />
    );

    await user.click(screen.getByRole('button', { name: /extend play time/i }));
    const input = screen.getByLabelText(/total quiz duration \(seconds\)/i);
    await user.clear(input);
    await user.type(input, '200');
    expect(input).toHaveValue(200);

    rerender(
      <QuizDurationField
        expectedPlaySeconds={20}
        maximumSeconds={140}
        minimumSeconds={50}
        mode="live"
        onDurationChange={onDurationChange}
        totalDurationSeconds={140}
      />
    );

    expect(input).toHaveValue(140);
  });
});
