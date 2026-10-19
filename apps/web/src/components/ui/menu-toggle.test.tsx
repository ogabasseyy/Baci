import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MenuToggle } from './menu-toggle';

describe('MenuToggle', () => {
  it('toggles the menu label and expanded state', () => {
    const onClick = vi.fn();
    const { rerender } = render(<MenuToggle onClick={onClick} />);

    const closed = screen.getByRole('button', { name: 'Open menu' });
    expect(closed).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(closed);
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<MenuToggle isOpen onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});
