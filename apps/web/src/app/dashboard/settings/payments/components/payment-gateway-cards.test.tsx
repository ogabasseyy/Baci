import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentGatewaySettings } from '../payment-settings';
import { PaymentGatewayCards } from './payment-gateway-cards';

const settings: PaymentGatewaySettings = {
  credit_direct_enabled: false,
  korapay_enabled: false,
  oxygen_enabled: false,
  pay_on_delivery_enabled: false,
  paystack_enabled: false,
  preferred_international_gateway: 'korapay',
  preferred_local_gateway: 'paystack',
};

describe('PaymentGatewayCards', () => {
  it('updates Pay on Delivery without enabling an unavailable Paystack gateway', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    render(
      <PaymentGatewayCards
        hasPaystackSubaccount={false}
        isPaystackSupported={false}
        onSettingsChange={onSettingsChange}
        paystackFixedFee="₦100"
        settings={settings}
      />
    );

    expect(
      screen.getByText(/paystack is not available for this country yet/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: /toggle paystack/i })
    ).toBeDisabled();

    await user.click(
      screen.getByRole('switch', { name: /toggle pay on delivery/i })
    );

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      pay_on_delivery_enabled: true,
    });
  });
});
