import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReceiptStatusBadge } from './ReceiptStatusBadge';

describe('ReceiptStatusBadge', () => {
  it.each([
    ['Paid', 'Paid', 'bg-store-primary'],
    ['Partially Paid', 'Partial', 'bg-store-secondary'],
    ['Unpaid', 'Unpaid', 'bg-destructive'],
    ['unknown', 'Unpaid', 'bg-destructive'],
  ])('renders the %s badge', (status, label, tone) => {
    render(<ReceiptStatusBadge status={status} />);

    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain(tone);
  });
});
