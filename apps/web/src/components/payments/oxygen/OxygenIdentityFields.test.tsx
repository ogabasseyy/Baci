import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { oxygenIdentityTurns } from './OxygenChatQuestion';
import { OxygenIdentityFields } from './OxygenIdentityFields';

describe('OxygenIdentityFields', () => {
  it('shows only the active identity turn in conversational mode', () => {
    const { container } = render(
      <form>
        <OxygenIdentityFields
          conversational
          chatTurn={oxygenIdentityTurns.bvn}
          prefill={{
            first_name: 'Ada',
            last_name: 'Obi',
            email: 'ada@example.com',
          }}
          defaults={{ bvn: '', nin: '' }}
          onCapture={vi.fn()}
        />
      </form>
    );
    expect(screen.getByText(/11-digit BVN privately/i)).toBeInTheDocument();
    expect(
      container.querySelector('[data-oxygen-chat-question="0"]')
    ).not.toHaveAttribute('hidden');
    expect(
      container.querySelector('[data-oxygen-chat-question="1"]')
    ).toHaveAttribute('hidden');
  });
});
