import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it.each([
    { status: 'Pending', type: 'shipping' as const },
    { status: 'Processing', type: 'shipping' as const },
    { status: 'Paid', type: 'payment' as const },
  ])('renders the provided $type status label for $status', (scenario) => {
    render(<StatusBadge status={scenario.status} type={scenario.type} />);

    expect(screen.getByText(scenario.status)).toBeInTheDocument();
  });

  it('styles the Cancelled spelling like Canceled', () => {
    render(<StatusBadge status="Cancelled" type="shipping" />);

    expect(screen.getByText('Cancelled')).toHaveClass('bg-red-100');
  });
});
