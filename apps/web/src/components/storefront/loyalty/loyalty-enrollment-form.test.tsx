import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoyaltyEnrollmentForm } from './loyalty-enrollment-form';

let enrolledNow = false;

const enroll = vi.fn(async () => {
  // The hook refresh flips enrolled before enroll() returns.
  enrolledNow = true;
  return { success: true, points_balance: 250, referral_code: 'REF-1' };
});

vi.mock('@/hooks/use-loyalty', () => ({
  useLoyalty: () => ({ enrolled: enrolledNow, enroll, data: null }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('LoyaltyEnrollmentForm', () => {
  it('shows the receipt even though enrollment flipped enrolled', async () => {
    enrolledNow = false;

    render(<LoyaltyEnrollmentForm merchantId="m" customerId="c" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Join Loyalty Program' })
    );

    await waitFor(() => {
      expect(screen.getByText('Welcome to the Club!')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/earned 250 welcome bonus points/)
    ).toBeInTheDocument();
    expect(screen.getByText('REF-1')).toBeInTheDocument();
  });

  it('renders nothing when already enrolled without a fresh receipt', () => {
    enrolledNow = true;

    const { container } = render(
      <LoyaltyEnrollmentForm merchantId="m" customerId="c" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('calls onReceiptDismiss when the receipt is dismissed', async () => {
    enrolledNow = false;
    const onReceiptDismiss = vi.fn();

    render(
      <LoyaltyEnrollmentForm
        merchantId="m"
        customerId="c"
        onReceiptDismiss={onReceiptDismiss}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Join Loyalty Program' })
    );

    await waitFor(() => {
      expect(screen.getByText('Welcome to the Club!')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'View my rewards' }));

    expect(onReceiptDismiss).toHaveBeenCalledTimes(1);
  });
});
