import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildPayerHandoff } from './order-success-payer-handoff';
import { OrderSuccessPayerHandoff } from './order-success-payer-handoff-view';

function baseOrder() {
  return {
    id: 'order-1',
    order_number: 'BAC-001',
    total: 5000,
    amount_paid: 0,
    payment_status: 'pending',
    shipping_status: 'pending',
    currency: 'NGN',
    virtual_account: {
      bank_name: 'Paystack',
      account_name: 'BACI Test',
      account_number: '0123456789',
    },
  } as never;
}

function unpaidHandoff() {
  return buildPayerHandoff({
    order: baseOrder(),
    payerNameParam: 'Zain',
    type: 'payforme',
  });
}

describe('OrderSuccessPayerHandoff', () => {
  it('renders nothing when the handoff is suppressed', () => {
    const { container } = render(
      <OrderSuccessPayerHandoff
        handoff={{ ...unpaidHandoff(), isPayForMeUnpaid: false }}
        order={baseOrder()}
        payerDetailsCopied={false}
        onCopied={() => {}}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the amount, order, and transfer details with a copy button', () => {
    const onCopied = vi.fn();
    render(
      <OrderSuccessPayerHandoff
        handoff={unpaidHandoff()}
        order={baseOrder()}
        payerDetailsCopied={false}
        onCopied={onCopied}
      />
    );

    expect(screen.getByText('Payment details for Zain')).toBeInTheDocument();
    expect(screen.getByText('BAC-001')).toBeInTheDocument();
    expect(screen.getByText('0123456789')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /copy payment details/i })
    ).toBeInTheDocument();
  });

  it('copies the details text on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(window.navigator, { clipboard: { writeText } });
    const onCopied = vi.fn();
    render(
      <OrderSuccessPayerHandoff
        handoff={unpaidHandoff()}
        order={baseOrder()}
        payerDetailsCopied={false}
        onCopied={onCopied}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /copy payment details/i })
    );
    await screen.findByText('0123456789');
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onCopied).toHaveBeenCalledWith(true);
  });
});
