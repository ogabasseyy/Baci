import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeartIcon } from './heart-icon';

describe('HeartIcon', () => {
  it('toggles the heart label, fill, and handler', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<HeartIcon onToggle={onToggle} />);

    const like = screen.getByRole('button', { name: 'Like' });
    fireEvent.click(like);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<HeartIcon liked onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Unlike' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Unlike' }).querySelector('svg')
    ).toHaveAttribute('fill', 'currentColor');
  });
});
