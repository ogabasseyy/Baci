import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RedemptionSuccessDialog } from './redemption-success-dialog';

const mockToast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const RESULT = {
  code: 'RDM-ABC123',
  instructions: 'Apply this code at checkout.',
  expiresAt: '2026-11-09T00:00:00.000Z',
};

describe('RedemptionSuccessDialog', () => {
  it('renders the code, instructions, and formatted expiry', () => {
    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={RESULT}
      />
    );

    expect(screen.getByText('RDM-ABC123')).toBeInTheDocument();
    expect(
      screen.getByText('Apply this code at checkout.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Expires: ${new Date(RESULT.expiresAt).toLocaleDateString('en-NG', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })}`,
        { exact: false }
      )
    ).toBeInTheDocument();
  });

  it('hides the code block and shows credit text for store_credit', () => {
    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={{ ...RESULT, rewardType: 'store_credit' }}
      />
    );

    expect(
      screen.getByText(/The credit is now on your store balance\./)
    ).toBeInTheDocument();
    expect(screen.queryByText('RDM-ABC123')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Copy redemption code' })
    ).not.toBeInTheDocument();
    // The credited balance has no expiry mechanism: showing the
    // redemption expiry would wrongly suggest the balance lapses.
    expect(screen.queryByText(/Expires:/)).not.toBeInTheDocument();
  });

  it.each([
    'free_product',
    'exclusive_access',
    'free_shipping',
  ])('shows present-the-code copy without checkout direction for %s', (rewardType) => {
    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={{
          ...RESULT,
          rewardType,
          instructions: 'Present this code to claim your reward.',
        }}
      />
    );

    expect(
      screen.getByText(/Present the code below as instructed\./)
    ).toBeInTheDocument();
    expect(screen.queryByText(/at checkout/)).not.toBeInTheDocument();
    // The code itself is still shown: the customer presents it.
    expect(screen.getByText('RDM-ABC123')).toBeInTheDocument();
  });

  it('copies the code and toasts on copy click', async () => {
    mockToast.mockClear();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={RESULT}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy redemption code' })
    );

    expect(writeText).toHaveBeenCalledWith('RDM-ABC123');
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Copied!',
        description: 'Redemption code copied to clipboard',
      });
    });
    vi.unstubAllGlobals();
  });

  it('toasts a failure instead of success when the clipboard rejects', async () => {
    mockToast.mockClear();
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={RESULT}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Copy redemption code' })
    );

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Copy failed',
        description: 'Select the code and copy it manually',
        variant: 'destructive',
      });
    });
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Copied!' })
    );
    vi.unstubAllGlobals();
  });

  it('closes through onOpenChange on Done', () => {
    const onOpenChange = vi.fn();

    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={onOpenChange}
        result={RESULT}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders Done with the storefront brand palette', () => {
    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={RESULT}
      />
    );

    expect(screen.getByRole('button', { name: 'Done' }).className).toContain(
      'bg-store-primary'
    );
  });

  it.each([
    { discountValue: undefined },
    { discountValue: 0 },
  ])('shows present-the-code copy for a valueless discount (%o)', ({
    discountValue,
  }) => {
    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={{
          ...RESULT,
          rewardType: 'discount',
          discountValue,
          instructions: 'Present this code to receive your discount.',
        }}
      />
    );

    expect(
      screen.getByText(/Present the code below as instructed\./)
    ).toBeInTheDocument();
    expect(screen.queryByText(/at checkout/)).not.toBeInTheDocument();
    expect(screen.getByText('RDM-ABC123')).toBeInTheDocument();
  });

  it('keeps the checkout direction for a valued discount', () => {
    render(
      <RedemptionSuccessDialog
        open={true}
        onOpenChange={() => {}}
        result={{
          ...RESULT,
          rewardType: 'discount',
          discountValue: 1500,
        }}
      />
    );

    expect(
      screen.getByText(/Use the code below at checkout\./)
    ).toBeInTheDocument();
  });
});
