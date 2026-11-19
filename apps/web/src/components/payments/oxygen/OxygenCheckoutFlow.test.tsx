import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OxygenCheckoutSnapshot } from '@/lib/payments/oxygen/checkout';
import { createSimulatedOxygenCheckout } from '@/lib/payments/oxygen/simulated-checkout';
import { OxygenCheckoutFlow } from './OxygenCheckoutFlow';

afterEach(() => vi.unstubAllGlobals());

describe('Oxygen checkout with simulated responses', () => {
  it('closes a hosted step from an old booking when the checkout session changes', async () => {
    const user = userEvent.setup();
    const first = createSimulatedOxygenCheckout();
    const view = render(<OxygenCheckoutFlow adapter={first} />);
    await user.click(
      await screen.findByRole('checkbox', {
        name: 'I accept this repayment plan',
      })
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    await user.click(
      await screen.findByRole('button', { name: 'Open payment' })
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    view.rerender(
      <OxygenCheckoutFlow adapter={createSimulatedOxygenCheckout()} />
    );
    await screen.findByRole('checkbox', {
      name: 'I accept this repayment plan',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows charges separately from equity and monthly instalments', async () => {
    render(<OxygenCheckoutFlow adapter={createSimulatedOxygenCheckout()} />);
    const breakdown = await screen.findByRole('group', {
      name: 'Payment breakdown',
    });
    expect(within(breakdown).getByText('₦140,000.00')).toBeInTheDocument();
    expect(within(breakdown).getByText('₦5,135.00')).toBeInTheDocument();
    expect(within(breakdown).getByText('₦145,135.00')).toBeInTheDocument();
    expect(screen.getByText('₦32,345.62')).toBeInTheDocument();
    expect(screen.getByText('₦437,480.62')).toBeInTheDocument();
    expect(screen.getAllByText('₦97,449.00')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeDisabled();
    expect(
      screen.getByText(/No real payment is collected/)
    ).toBeInTheDocument();
  });
  it('completes the full simulated flow only after acceptance and both return checks, with no network calls', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('Network forbidden in simulation');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const user = userEvent.setup();
    render(<OxygenCheckoutFlow adapter={createSimulatedOxygenCheckout()} />);
    await user.click(
      await screen.findByRole('checkbox', {
        name: 'I accept this repayment plan',
      })
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    await user.click(
      await screen.findByRole('button', { name: 'Open payment' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Return without completing' })
    );
    expect(await screen.findByText('Payment pending')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm simulation' })
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Open payment' }));
    await user.click(
      screen.getByRole('button', { name: 'Simulate successful payment' })
    );
    expect(await screen.findByText('Payment completed')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Confirm simulation' })
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Open repayment setup' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Simulate successful setup' })
    );
    await user.click(
      await screen.findByRole('button', { name: 'Confirm simulation' })
    );
    expect(
      await screen.findByRole('heading', { name: 'Simulation complete' })
    ).toBeInTheDocument();
    expect(screen.getByText(/offer letter.*email/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No real activation or merchant settlement/)
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('replaces the booking after changing the plan and requires fresh acceptance', async () => {
    const user = userEvent.setup();
    render(<OxygenCheckoutFlow adapter={createSimulatedOxygenCheckout()} />);
    await user.click(
      await screen.findByRole('checkbox', {
        name: 'I accept this repayment plan',
      })
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Down payment' }),
      '30'
    );
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Update plan' }));
    expect(await screen.findByText('₦125,530.00')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'I accept this repayment plan' })
    ).not.toBeChecked();
  });
  it('keeps the customer in the payment step when the status check fails', async () => {
    const user = userEvent.setup();
    const real = createSimulatedOxygenCheckout();
    const adapter = {
      ...real,
      checkCompletion: () =>
        Promise.reject(new Error('private-provider-error')),
    };
    render(<OxygenCheckoutFlow adapter={adapter} />);
    await user.click(
      await screen.findByRole('checkbox', {
        name: 'I accept this repayment plan',
      })
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue to payment' })
    );
    await user.click(
      await screen.findByRole('button', { name: 'Check payment status' })
    );
    expect(await screen.findByRole('alert')).not.toHaveTextContent(
      'private-provider-error'
    );
    expect(
      screen.getByRole('button', { name: 'Confirm simulation' })
    ).toBeDisabled();
  });
  it('ignores an old adapter response when the checkout session changes', async () => {
    const first = createSimulatedOxygenCheckout();
    const old = await first.load();
    let resolve: ((value: OxygenCheckoutSnapshot) => void) | undefined;
    const second = createSimulatedOxygenCheckout();
    const initial = await second.load();
    await second.replaceBooking(initial.bookingReference, 30);
    const rendered = render(
      <OxygenCheckoutFlow
        adapter={{
          ...first,
          load: () =>
            new Promise((done) => {
              resolve = done;
            }),
        }}
      />
    );
    rendered.rerender(<OxygenCheckoutFlow adapter={second} />);
    expect(await screen.findByText('₦125,530.00')).toBeInTheDocument();
    await act(async () => resolve?.(old));
    expect(screen.getByText('₦125,530.00')).toBeInTheDocument();
    expect(screen.queryByText('₦145,135.00')).not.toBeInTheDocument();
  });
});
