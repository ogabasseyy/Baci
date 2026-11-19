import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import '@/test/payment-methods-screen';
import { PaymentMethodsFooter } from './PaymentMethodsFooter';

const themeColors = {
  infoLight: '#E0F2FE',
  info: '#0284C7',
  primary: '#0F172A',
  textOnPrimary: '#ABCDEF',
} as ThemeColors;

describe('PaymentMethodsFooter', () => {
  it('renders notice, Advanced Settings button, and propagates theme tokens', () => {
    const onManagePayments = vi.fn();
    const { container } = render(
      <PaymentMethodsFooter
        colors={themeColors}
        onManagePayments={onManagePayments}
      />
    );

    expect(
      screen.getByText(
        'API keys and webhook configuration available on web dashboard.'
      )
    ).toHaveAttribute('data-color', '#0284C7');
    expect(
      container.querySelector('[data-icon-name="information-circle"]')
    ).toHaveAttribute('data-icon-color', '#0284C7');
    expect(
      container.querySelector('[data-icon-name="settings-outline"]')
    ).toHaveAttribute('data-icon-color', '#ABCDEF');
    expect(screen.getByText('Advanced Settings')).toHaveAttribute(
      'data-color',
      '#ABCDEF'
    );
  });

  it('calls onManagePayments when Advanced Settings is pressed', () => {
    const onManagePayments = vi.fn();
    render(
      <PaymentMethodsFooter
        colors={themeColors}
        onManagePayments={onManagePayments}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Advanced Settings/i }));

    expect(onManagePayments).toHaveBeenCalledTimes(1);
  });
});
