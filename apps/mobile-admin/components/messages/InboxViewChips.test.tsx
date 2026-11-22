import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { InboxViewChips } from './InboxViewChips';

describe('InboxViewChips', () => {
  it('lists every view and marks the selected one', () => {
    render(
      <InboxViewChips
        colors={LIGHT_COLORS}
        onChange={vi.fn()}
        value="follow_up"
      />
    );

    for (const label of ['Needs reply', 'Unread', 'Follow-up', 'Done', 'All']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // The selected chip is filled with the primary colour; the others are not.
    expect(screen.getByRole('button', { name: 'Follow-up' })).toHaveStyle({
      backgroundColor: LIGHT_COLORS.primary,
    });
    expect(screen.getByRole('button', { name: 'Unread' })).not.toHaveStyle({
      backgroundColor: LIGHT_COLORS.primary,
    });
  });

  it('reports the tapped view', () => {
    const onChange = vi.fn();
    render(
      <InboxViewChips
        colors={LIGHT_COLORS}
        onChange={onChange}
        value="needs_reply"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onChange).toHaveBeenCalledWith('done');
  });
});
