import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReceiptStatusBadge } from './ReceiptStatusBadge';

describe('ReceiptStatusBadge', () => {
  it.each([
    ['Paid', 'Paid', 'text-green-700'],
    ['Partially Paid', 'Partial', 'text-yellow-700'],
    ['Unpaid', 'Unpaid', 'text-red-700'],
    ['unknown', 'Unpaid', 'text-red-700'],
  ])('renders the %s badge', (status, label, tone) => {
    render(<ReceiptStatusBadge status={status} />);

    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain(tone);
  });
});
