import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentGatewaySettings } from '../payment-settings';
import { PaymentPreferencesCard } from './payment-preferences-card';

const settings: PaymentGatewaySettings = {
  credit_direct_enabled: false,
  korapay_enabled: false,
  oxygen_enabled: false,
  pay_on_delivery_enabled: true,
  paystack_enabled: false,
  preferred_international_gateway: 'korapay',
  preferred_local_gateway: 'korapay',
};

describe('PaymentPreferencesCard', () => {
  it('uses the merchant currency and avoids a Nigerian Paystack fee outside Nigeria', () => {
    render(
      <PaymentPreferencesCard
        hasPaystackSubaccount={false}
        isPaystackSupported={false}
        merchantCurrencyCode="INR"
        onSettingsChange={vi.fn()}
        paystackFixedFee="₦100"
        platformFeeCap={null}
        settings={settings}
      />
    );

    expect(screen.getByText('Local Payments (INR)')).toBeInTheDocument();
    expect(screen.getByText(/Baci charges/i)).not.toHaveTextContent('₦100');
    expect(screen.getByText(/Baci charges/i)).toHaveTextContent(
      '2% per transaction'
    );
  });

  it('toggles Oxygen BNPL setting when clicked', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    render(
      <PaymentPreferencesCard
        hasPaystackSubaccount={false}
        isPaystackSupported={true}
        merchantCurrencyCode="NGN"
        onSettingsChange={onSettingsChange}
        paystackFixedFee="₦100"
        platformFeeCap="₦2,050"
        settings={settings}
      />
    );

    await user.click(screen.getByRole('switch', { name: /toggle oxygen/i }));

    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      oxygen_enabled: true,
    });
  });
});
