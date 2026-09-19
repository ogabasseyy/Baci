import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaticUtilityOptionButton } from './static-utility-option-button';

describe('StaticUtilityOptionButton', () => {
  it('exposes the replay hook and stays unfocusable', () => {
    render(
      <StaticUtilityOptionButton
        isActive={false}
        label="Data"
        optionId="data"
        tone="mobile"
      />
    );

    const button = screen.getByRole('button', { name: 'Data' });
    expect(button).toHaveAttribute('data-utility-option', 'data');
    expect(button).toHaveAttribute('tabindex', '-1');
  });

  it('styles the active option distinctly', () => {
    const { rerender } = render(
      <StaticUtilityOptionButton
        isActive={false}
        label="Data"
        optionId="data"
        tone="mobile"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Data' }).firstChild
    ).not.toHaveClass('bg-primary/10');

    rerender(
      <StaticUtilityOptionButton
        isActive
        label="Data"
        optionId="data"
        tone="mobile"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Data' }).firstChild
    ).toHaveClass('bg-primary/10');
  });

  it('does nothing on click (handler-free fallback)', () => {
    const onClick = vi.fn();
    render(
      <StaticUtilityOptionButton
        isActive={false}
        label="Data"
        optionId="data"
        tone="desktop"
      />
    );

    // No onClick prop exists: taps do nothing until the gate swaps.
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
