import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnimatedIcon } from './animated-icons';

describe('animated-icons', () => {
  it('renders a non-interactive div wrapper without onClick', () => {
    const { container } = render(
      <AnimatedIcon animation="spin" hoverEffect="rotate">
        <span>icon</span>
      </AnimatedIcon>
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.tagName).toBe('DIV');
    expect(wrapper).toHaveTextContent('icon');
    expect(wrapper?.className).toContain('motion-safe:animate-spin');
    expect(wrapper?.className).toContain('motion-safe:hover:rotate-12');
  });

  it('renders an interactive button wrapper with onClick and aria-label', () => {
    const onClick = vi.fn();
    render(
      <AnimatedIcon ariaLabel="Refresh" hoverEffect="scale" onClick={onClick}>
        <span>icon</span>
      </AnimatedIcon>
    );

    const button = screen.getByRole('button', { name: 'Refresh' });
    expect(button).toHaveClass('motion-safe:hover:scale-[1.15]');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
