import { COUNTER_NEGOTIATION_DISCOUNT_STEPS } from '@baci/shared/lib';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NegotiationModalStatusContent } from './NegotiationModalStatusContent';

describe('NegotiationModalStatusContent', () => {
  it('announces processing state changes', () => {
    render(
      <NegotiationModalStatusContent
        attemptCount={0}
        counterOffer={null}
        message=""
        onAcceptCounter={vi.fn()}
        onClose={vi.fn()}
        onNegotiateAgain={vi.fn()}
        onShowUpload={vi.fn()}
        status="processing"
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Reviewing your offer…'
    );
  });

  it('offers merchant review after the final counter attempt', () => {
    const onAcceptCounter = vi.fn();
    const onShowUpload = vi.fn();
    render(
      <NegotiationModalStatusContent
        attemptCount={COUNTER_NEGOTIATION_DISCOUNT_STEPS.length}
        counterOffer={95_000}
        message="Final offer"
        onAcceptCounter={onAcceptCounter}
        onClose={vi.fn()}
        onNegotiateAgain={vi.fn()}
        onShowUpload={onShowUpload}
        status="failed"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /accept/i }));
    fireEvent.click(screen.getByRole('button', { name: /saw it cheaper/i }));
    expect(onAcceptCounter).toHaveBeenCalledOnce();
    expect(onShowUpload).toHaveBeenCalledOnce();
  });

  it('hides merchant review immediately below the final counter boundary', () => {
    render(
      <NegotiationModalStatusContent
        attemptCount={COUNTER_NEGOTIATION_DISCOUNT_STEPS.length - 1}
        counterOffer={95_000}
        message="One attempt remains"
        onAcceptCounter={vi.fn()}
        onClose={vi.fn()}
        onNegotiateAgain={vi.fn()}
        onShowUpload={vi.fn()}
        status="failed"
      />
    );

    expect(
      screen.queryByRole('button', { name: /saw it cheaper/i })
    ).not.toBeInTheDocument();
  });

  it('hides counter-price actions when no counter offer is available', () => {
    render(
      <NegotiationModalStatusContent
        attemptCount={0}
        counterOffer={null}
        message="No counter available"
        onAcceptCounter={vi.fn()}
        onClose={vi.fn()}
        onNegotiateAgain={vi.fn()}
        onShowUpload={vi.fn()}
        status="failed"
      />
    );

    expect(
      screen.queryByRole('button', { name: /accept/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Negotiate Again' })
    ).toBeVisible();
    expect(screen.getByText('No counter available')).toBeVisible();
  });

  it('renders the submitted outcome', () => {
    render(
      <NegotiationModalStatusContent
        attemptCount={0}
        counterOffer={null}
        message="Request submitted"
        onAcceptCounter={vi.fn()}
        onClose={vi.fn()}
        onNegotiateAgain={vi.fn()}
        onShowUpload={vi.fn()}
        status="submitted"
      />
    );

    expect(screen.getByRole('heading', { name: 'Request Sent' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Request submitted')).toBeVisible();
  });

  it('uses the cart-update fallback for a successful offer', () => {
    const onClose = vi.fn();
    render(
      <NegotiationModalStatusContent
        attemptCount={0}
        counterOffer={null}
        message=""
        onAcceptCounter={vi.fn()}
        onClose={onClose}
        onNegotiateAgain={vi.fn()}
        onShowUpload={vi.fn()}
        status="success"
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Offer Accepted!' })
    ).toBeVisible();
    expect(
      screen.getByText('Price has been updated in your cart.')
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the final price outcome', () => {
    render(
      <NegotiationModalStatusContent
        attemptCount={0}
        counterOffer={null}
        message="Best we can do"
        onAcceptCounter={vi.fn()}
        onClose={vi.fn()}
        onNegotiateAgain={vi.fn()}
        onShowUpload={vi.fn()}
        status="final"
      />
    );

    expect(screen.getByRole('heading', { name: 'Final Price' })).toBeVisible();
    expect(screen.getByText('Best we can do')).toBeVisible();
  });
});
