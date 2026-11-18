import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mocks,
  resetPaymentMethodsScreenMocks,
} from '@/test/payment-methods-screen';
import PaymentMethodsScreen from './payment-methods';

describe('PaymentMethodsScreen theme tokens', () => {
  beforeEach(resetPaymentMethodsScreenMocks);

  it('uses the textOnPrimary theme token on primary action icons and labels', () => {
    mocks.textOnPrimary = '#123456';
    const { container } = render(<PaymentMethodsScreen />);

    expect(
      container.querySelector('[data-icon-name="settings-outline"]')
    ).toHaveAttribute('data-icon-color', mocks.textOnPrimary);
    expect(screen.getByText('Advanced Settings')).toHaveAttribute(
      'data-color',
      mocks.textOnPrimary
    );
  });

  it('uses the textOnPrimary theme token on the retry button label', () => {
    mocks.textOnPrimary = '#123456';
    mocks.useQuery.mockReturnValue({
      data: undefined,
      error: new Error('Failed to fetch'),
      isError: true,
      isLoading: false,
      refetch: mocks.refetch,
    });

    render(<PaymentMethodsScreen />);

    expect(screen.getByText('Retry')).toHaveAttribute(
      'data-color',
      mocks.textOnPrimary
    );
  });
});
