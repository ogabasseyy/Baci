import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  OxygenPaymentSurfaceContext,
  OxygenSelfieSurfaceContext,
} from './OxygenPaymentSurfaceContext';

const capture = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: capture,
}));
vi.mock('./OxygenProviderFlow', () => ({
  OxygenProviderFlow: ({
    active,
    onProgress,
  }: {
    active?: boolean;
    onProgress?(stage: 'income'): void;
  }) => {
    const openPayment = useContext(OxygenPaymentSurfaceContext);
    const openSelfie = useContext(OxygenSelfieSurfaceContext);
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            openPayment?.(
              'https://payment.hydrogenpay.com/?transactionId=synthetic'
            )
          }
        >
          Open saved payment
        </button>
        <button
          type="button"
          onClick={() =>
            openSelfie?.(
              'https://staging.d1l1k5yxed9cvn.amplifyapp.com/?token=synthetic'
            )
          }
        >
          Open saved selfie
        </button>
        <input aria-label="Private identity value" />
        <button type="button" onClick={() => onProgress?.('income')}>
          Simulate income step
        </button>
        <span>
          {active ? 'Background checks enabled' : 'Background checks paused'}
        </span>
      </div>
    );
  },
}));

import { OxygenApplicationDialog } from './OxygenApplicationDialog';

beforeEach(() => {
  capture.mockClear();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

it('opens over checkout, preserves fields on close/reopen, and reports interruption without identity data', () => {
  render(<OxygenApplicationDialog orderId="order-1" />);
  expect(
    screen.getByRole('dialog', { name: 'Your Oxygen application' })
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText('Private identity value'), {
    target: { value: 'sensitive' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close application' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue application' }));
  expect(screen.getByLabelText('Private identity value')).toHaveValue(
    'sensitive'
  );
  expect(capture.mock.calls.map(([event]) => event)).toEqual([
    'oxygen_application_opened',
    'oxygen_application_closed',
    'oxygen_application_opened',
  ]);
  expect(JSON.stringify(capture.mock.calls)).not.toContain('sensitive');
  expect(screen.queryByRole('button', { name: /activate|settle/i })).toBeNull();
});

it('handles Escape as a resumable close', () => {
  render(<OxygenApplicationDialog orderId="order-1" />);
  fireEvent(
    screen.getByRole('dialog'),
    new Event('cancel', { cancelable: true })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Continue application' })
  ).toBeVisible();
});

it('records page exits only while the application is open', () => {
  render(<OxygenApplicationDialog orderId="order-1" />);
  fireEvent(window, new Event('pagehide'));
  expect(capture).toHaveBeenCalledWith('oxygen_application_page_left', {
    order_id: 'order-1',
    provider: 'oxygen',
    stage: 'loading',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Close application' }));
  capture.mockClear();
  fireEvent(window, new Event('pagehide'));
  expect(capture).not.toHaveBeenCalled();
  expect(document.body.style.overflow).not.toBe('hidden');
});

it('records the current customer step on close and pauses background checks until reopening', () => {
  render(<OxygenApplicationDialog orderId="order-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Simulate income step' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close application' }));
  expect(capture).toHaveBeenCalledWith('oxygen_application_closed', {
    order_id: 'order-1',
    provider: 'oxygen',
    stage: 'income',
  });
  expect(screen.getByText('Background checks paused')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue application' }));
  expect(screen.getByText('Background checks enabled')).toBeVisible();
});

it('keeps the generic application heading accessible without repeating a visible banner', () => {
  render(<OxygenApplicationDialog orderId="order-1" />);
  expect(
    screen.getByRole('heading', { name: 'Your Oxygen application' })
  ).toHaveClass('sr-only');
  expect(
    screen.getByRole('button', { name: 'Close application' })
  ).toBeVisible();
});

it('reuses one dialog for payment, fits the hosted panel and restores the saved application on back', async () => {
  render(<OxygenApplicationDialog orderId="order-1" />);
  fireEvent.change(screen.getByLabelText('Private identity value'), {
    target: { value: 'preserved' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open saved payment' }));
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Secure payment' })).toBeVisible();
  await waitFor(() =>
    expect(screen.getByTitle('Oxygen secure payment')).toBeInTheDocument()
  );
  expect(
    screen.queryByRole('button', { name: 'Close application' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to payment plan' }));
  expect(screen.queryByTitle('Oxygen secure payment')).toBeNull();
  expect(screen.getByLabelText('Private identity value')).toHaveValue(
    'preserved'
  );
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
});

it('uses the same modal for selfie, pauses background checks, and preserves application fields on return', () => {
  render(<OxygenApplicationDialog orderId="order-1" />);
  const dialog = screen.getByRole('dialog');
  fireEvent.change(screen.getByLabelText('Private identity value'), {
    target: { value: 'preserved' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open saved selfie' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.getByTitle('Oxygen selfie verification')).toBeVisible();
  expect(screen.getByText('Background checks paused')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to application' }));
  expect(screen.queryByTitle('Oxygen selfie verification')).toBeNull();
  expect(screen.getByLabelText('Private identity value')).toHaveValue(
    'preserved'
  );
  expect(screen.getByText('Background checks enabled')).toBeVisible();
});
