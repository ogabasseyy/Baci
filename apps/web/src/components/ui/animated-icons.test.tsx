import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnimatedIcon } from './animated-icons';
import { CartIcon } from './cart-icon';
import { ChevronToggle } from './chevron-toggle';
import { HeartIcon } from './heart-icon';
import { LoadingSpinner } from './loading-spinner';
import { MenuToggle } from './menu-toggle';
import { NotificationBell } from './notification-bell';
import { QuantityButton } from './quantity-button';
import { SuccessCheck } from './success-check';

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

  it('spins the loading spinner with a sized hidden svg', () => {
    const { container } = render(<LoadingSpinner size={32} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '32');
    expect(container.firstElementChild?.className).toContain(
      'motion-safe:animate-spin'
    );
  });

  it('applies the success check delay and gated entrance', () => {
    const { container } = render(<SuccessCheck delay={0.5} />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('style')).toContain('animation-delay: 0.5s');
    expect(svg?.className.baseVal ?? svg?.className).toContain(
      'motion-safe:zoom-in-95'
    );
  });

  it('shows the notification dot and wiggle only with a notification', () => {
    const { container, rerender } = render(<NotificationBell size={20} />);

    expect(container.querySelector('.bg-red-500')).toBeNull();

    rerender(<NotificationBell hasNotification size={20} />);
    expect(container.querySelector('.bg-red-500')).not.toBeNull();
    expect(container.innerHTML).toContain('motion-safe:animate-wiggle');
  });

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

  it('caps the cart badge at 99+ and hides it at zero', () => {
    const { container, rerender } = render(<CartIcon count={0} />);

    expect(container.textContent).not.toMatch(/99\+|\d/);

    rerender(<CartIcon count={3} />);
    expect(container.textContent).toContain('3');

    rerender(<CartIcon count={120} />);
    expect(container.textContent).toContain('99+');
  });

  it('labels quantity buttons and respects disabled', () => {
    const onClick = vi.fn();
    render(
      <>
        <QuantityButton type="plus" onClick={onClick} />
        <QuantityButton type="minus" onClick={onClick} disabled />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Decrease quantity' })
    ).toBeDisabled();
  });

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

  it('rotates the chevron only when expanded', () => {
    const { container, rerender } = render(<ChevronToggle />);

    expect(container.querySelector('svg')).not.toHaveClass('rotate-180');

    rerender(<ChevronToggle isExpanded />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('rotate-180');
    expect(svg).toHaveClass('motion-safe:transition-transform');
  });
});
