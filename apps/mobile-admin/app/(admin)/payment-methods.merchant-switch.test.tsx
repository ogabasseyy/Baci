import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mocks,
  resetPaymentMethodsScreenMocks,
} from '@/test/payment-methods-screen';
import PaymentMethodsScreen from './payment-methods';

describe('PaymentMethodsScreen merchant-switch toggle lifecycle', () => {
  beforeEach(resetPaymentMethodsScreenMocks);

  it('binds a payment toggle write to both its settings row and merchant', async () => {
    render(<PaymentMethodsScreen />);

    await mocks.mutationConfig?.mutationFn?.({
      field: 'paystack_enabled',
      merchantId: 'merchant-a',
      settingsId: 'settings-a',
      value: false,
    });

    expect(mocks.eq).toHaveBeenNthCalledWith(1, 'id', 'settings-a');
    expect(mocks.eq).toHaveBeenNthCalledWith(2, 'merchant_id', 'merchant-a');
  });

  it('does not leave merchant B payment controls pending after merchant A starts a toggle', async () => {
    let activeMerchantId = 'merchant-a';
    mocks.useMerchantResult = {
      isLoading: false,
      merchant: {
        get id() {
          return activeMerchantId;
        },
      },
      error: null,
    };
    mocks.isPending = true;

    const { rerender } = render(<PaymentMethodsScreen />);
    const originMutation = mocks.mutationConfig;
    await originMutation?.onMutate?.({
      field: 'paystack_enabled',
      merchantId: 'merchant-a',
      settingsId: 'settings-a',
      value: false,
    });
    activeMerchantId = 'merchant-b';
    rerender(<PaymentMethodsScreen />);

    expect(screen.getByLabelText('Toggle Paystack')).not.toBeDisabled();
  });

  it('does not alert merchant B when merchant A toggle fails after switching', async () => {
    let activeMerchantId = 'merchant-a';
    mocks.useMerchantResult = {
      isLoading: false,
      merchant: {
        get id() {
          return activeMerchantId;
        },
      },
      error: null,
    };

    const { rerender } = render(<PaymentMethodsScreen />);
    const originMutation = mocks.mutationConfig;
    const context = await originMutation?.onMutate?.({
      field: 'paystack_enabled',
      merchantId: 'merchant-a',
      settingsId: 'settings-a',
      value: false,
    });

    activeMerchantId = 'merchant-b';
    rerender(<PaymentMethodsScreen />);
    originMutation?.onError?.(
      new Error('Failed to update payment method'),
      { field: 'paystack_enabled', value: false },
      context
    );

    expect(mocks.setQueryData).toHaveBeenLastCalledWith(
      ['payment-settings', 'merchant-a'],
      expect.anything()
    );
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
