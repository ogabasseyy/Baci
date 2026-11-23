import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OxygenChatQuestion } from './OxygenChatQuestion';

describe('OxygenChatQuestion', () => {
  it('renders children directly when not in conversational turn mode', () => {
    render(
      <OxygenChatQuestion turn={0} prompt="Enter BVN">
        <input aria-label="BVN" />
      </OxygenChatQuestion>
    );
    expect(screen.getByLabelText('BVN')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the active turn prompt and hides inactive turns while preserving DOM values', () => {
    const { container } = render(
      <>
        <OxygenChatQuestion current={0} turn={0} prompt="Enter BVN">
          <input aria-label="BVN" />
        </OxygenChatQuestion>
        <OxygenChatQuestion current={0} turn={1} prompt="Enter NIN">
          <input aria-label="NIN" />
        </OxygenChatQuestion>
      </>
    );
    const active = container.querySelector('[data-oxygen-chat-question="0"]');
    const inactive = container.querySelector('[data-oxygen-chat-question="1"]');
    expect(active).not.toHaveAttribute('hidden');
    expect(inactive).toHaveAttribute('hidden');
    expect(screen.getByText('Enter BVN')).toBeInTheDocument();
  });
});
