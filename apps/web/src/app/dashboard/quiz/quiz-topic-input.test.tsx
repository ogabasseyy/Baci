import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizTopicInput } from './quiz-topic-input';

describe('QuizTopicInput', () => {
  it('uses one focus indicator for the topic field instead of a double outline', async () => {
    const user = userEvent.setup();
    render(<QuizTopicInput onChange={vi.fn()} topics={[]} />);

    const input = screen.getByPlaceholderText(/type a topic/i);
    const container = input.parentElement;

    await user.click(input);

    expect(container).toHaveClass('focus-within:border-ring');
    expect(container).not.toHaveClass('focus-within:ring-2');
    expect(input).toHaveClass('focus-visible:outline-none');
  });

  it('adds a topic with Enter and exposes removable chips', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuizTopicInput onChange={onChange} topics={['Phones']} />);
    await user.type(
      screen.getByPlaceholderText(/type a topic/i),
      'Laptops{Enter}'
    );
    expect(onChange).toHaveBeenCalledWith(['Phones', 'Laptops']);
    expect(
      screen.getByRole('button', { name: /remove phones/i })
    ).toBeInTheDocument();
  });
});
