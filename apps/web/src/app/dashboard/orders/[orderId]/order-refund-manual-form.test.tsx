import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrderRefundManualForm } from './order-refund-manual-form';

function props(overrides = {}) {
  return {
    amount: '10',
    busy: false,
    confirmed: true,
    currency: 'NGN',
    date: '2026-09-28T12:00',
    method: 'bank_transfer',
    note: '',
    onAmountChange: vi.fn(),
    onConfirmedChange: vi.fn(),
    onDateChange: vi.fn(),
    onMethodChange: vi.fn(),
    onNoteChange: vi.fn(),
    onReferenceChange: vi.fn(),
    onSubmit: vi.fn(),
    reference: 'bank-1',
    remaining: 80,
    ...overrides,
  };
}

describe('OrderRefundManualForm', () => {
  it('renders the audit fields and submits without navigating', () => {
    const onSubmit = vi.fn();
    render(<OrderRefundManualForm {...props({ onSubmit })} />);
    expect(screen.getByLabelText('Amount (NGN)')).toHaveValue(10);
    expect(screen.getByLabelText('Reference')).toHaveValue('bank-1');
    fireEvent.submit(
      screen.getByRole('button', { name: 'Save manual refund' })
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('forwards field edits to the panel state', () => {
    const onAmountChange = vi.fn();
    const onReferenceChange = vi.fn();
    const onConfirmedChange = vi.fn();
    render(
      <OrderRefundManualForm
        {...props({ onAmountChange, onConfirmedChange, onReferenceChange })}
      />
    );
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), {
      target: { value: '20' },
    });
    fireEvent.change(screen.getByLabelText('Reference'), {
      target: { value: 'bank-2' },
    });
    fireEvent.click(
      screen.getByLabelText('I confirm this money has already been refunded.')
    );
    expect(onAmountChange).toHaveBeenCalledWith('20');
    expect(onReferenceChange).toHaveBeenCalledWith('bank-2');
    expect(onConfirmedChange).toHaveBeenCalledWith(false);
  });

  it('disables saving while busy or unconfirmed', () => {
    const { rerender } = render(
      <OrderRefundManualForm {...props({ busy: true })} />
    );
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    rerender(
      <OrderRefundManualForm {...props({ busy: false, confirmed: false })} />
    );
    expect(
      screen.getByRole('button', { name: 'Save manual refund' })
    ).toBeDisabled();
  });
});
