import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutResumeStatus } from './CheckoutResumeStatus';

describe('CheckoutResumeStatus', () => {
  it.each([
    ['loading', 'Loading order...'],
    ['initializing', 'Initializing secure checkout...'],
  ] as const)('shows the %s status', (status, message) => {
    render(<CheckoutResumeStatus status={status} />);

    expect(screen.getByRole('status')).toHaveTextContent(message);
  });

  it('renders recovery actions and forwards retry, home, and support clicks', () => {
    const onRetry = vi.fn();
    const onGoHome = vi.fn();
    const onContactSupport = vi.fn();

    render(
      <CheckoutResumeStatus
        status="error"
        message="This order could not be loaded."
        onRetry={onRetry}
        onGoHome={onGoHome}
        onContactSupport={onContactSupport}
      />
    );

    expect(
      screen.getByText('This order could not be loaded.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Homepage' }));
    fireEvent.click(screen.getByRole('button', { name: 'contact support' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onGoHome).toHaveBeenCalledOnce();
    expect(onContactSupport).toHaveBeenCalledOnce();
  });
});
