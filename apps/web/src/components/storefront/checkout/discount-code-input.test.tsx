import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockToast, mockUseCurrencyWithCountry } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockUseCurrencyWithCountry: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/csrf', () => ({
  buildCsrfHeaders: () => ({ 'x-csrf-token': 'test-csrf-token' }),
}));

vi.mock('@/hooks/use-currency', () => ({
  useCurrencyWithCountry: mockUseCurrencyWithCountry,
}));

import { DiscountCodeInput } from './discount-code-input';

describe('DiscountCodeInput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockToast.mockReset();
    mockUseCurrencyWithCountry.mockReset();
    mockUseCurrencyWithCountry.mockReturnValue({
      formatCurrencyCompact: (amount: number) =>
        `₦${amount.toLocaleString('en-US')}`,
    });
  });

  beforeEach(() => {
    mockUseCurrencyWithCountry.mockReturnValue({
      formatCurrencyCompact: (amount: number) =>
        `₦${amount.toLocaleString('en-US')}`,
    });
  });

  it('uses the already parsed 403 payload without reading response body twice', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ valid: false, error: 'Code expired' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        onApply={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    await userEvent.type(
      screen.getByPlaceholderText('Enter discount code'),
      'save10'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.getByText('Code expired')).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends product_ids for targeted UX preflight and forwards the server discount_amount to onApply', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          valid: true,
          discount_code_id: '33333333-3333-4333-8333-333333333333',
          code: 'SAVE10',
          discount_type: 'percentage',
          discount_value: 10,
          discount_amount: 500,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const onApply = vi.fn();

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        productIds={['p-1', 'p-2']}
        onApply={onApply}
        onRemove={vi.fn()}
      />
    );

    await userEvent.type(
      screen.getByPlaceholderText('Enter discount code'),
      'save10'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({ discount_amount: 500, code: 'SAVE10' })
      );
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.product_ids).toEqual(['p-1', 'p-2']);
  });

  it('fails fast when csrf refresh endpoint returns non-ok during retry', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ valid: false, error: 'Invalid CSRF token' }),
          {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'csrf unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        onApply={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    await userEvent.type(
      screen.getByPlaceholderText('Enter discount code'),
      'save10'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(
        screen.getByText('Failed to validate code. Please try again.')
      ).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/csrf');
  });

  it('formats fixed discount values with compact checkout currency for applied discounts', () => {
    const appliedDiscount = {
      valid: true,
      code: 'FIXED10',
      discount_type: 'fixed' as const,
      discount_value: 1000,
    };

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        onApply={vi.fn()}
        onRemove={vi.fn()}
        appliedDiscount={appliedDiscount}
      />
    );

    // Assert that the badge correctly uses the mocked compact formatter.
    expect(screen.getByText('₦1,000 off')).toBeInTheDocument();
    expect(mockUseCurrencyWithCountry).toHaveBeenCalledWith('NG', null);
  });

  it('falls back to NG country while preserving merchant payout currency', () => {
    mockUseCurrencyWithCountry.mockReturnValue({
      formatCurrencyCompact: (amount: number) =>
        `GH₵${amount.toLocaleString('en-US')}`,
    });

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        currencyCountryCode={null}
        payoutCurrency="GHS"
        onApply={vi.fn()}
        onRemove={vi.fn()}
        appliedDiscount={{
          valid: true,
          code: 'FIXED10',
          discount_type: 'fixed',
          discount_value: 1000,
        }}
      />
    );

    expect(screen.getByText('GH₵1,000 off')).toBeInTheDocument();
    expect(mockUseCurrencyWithCountry).toHaveBeenCalledWith('NG', 'GHS');
  });

  it('formats applied fixed discounts with the provided merchant country', () => {
    mockUseCurrencyWithCountry.mockReturnValue({
      formatCurrencyCompact: (amount: number) =>
        `$${amount.toLocaleString('en-US')}`,
    });

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        currencyCountryCode="US"
        onApply={vi.fn()}
        onRemove={vi.fn()}
        appliedDiscount={{
          valid: true,
          code: 'FIXED10',
          discount_type: 'fixed',
          discount_value: 1000,
        }}
      />
    );

    expect(screen.getByText('$1,000 off')).toBeInTheDocument();
    expect(mockUseCurrencyWithCountry).toHaveBeenCalledWith('US', null);
  });

  it('uses compact checkout currency in the fixed-discount apply toast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          valid: true,
          code: 'FIXED10',
          discount_type: 'fixed',
          discount_value: 1000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        onApply={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    await userEvent.type(
      screen.getByPlaceholderText('Enter discount code'),
      'fixed10'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: '₦1,000 off applied to your order',
        })
      );
    });
  });

  it('does not apply the code when Enter confirms IME composition', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          valid: true,
          code: 'SAVE10',
          discount_type: 'percentage',
          discount_value: 10,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const onApply = vi.fn();

    render(
      <DiscountCodeInput
        merchantId="merchant-1"
        cartTotal={5000}
        onApply={onApply}
        onRemove={vi.fn()}
      />
    );

    const input = screen.getByRole('textbox', { name: 'Discount code' });
    await userEvent.type(input, 'save10');

    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(
      false
    );
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })).toBe(
      false
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(1);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
