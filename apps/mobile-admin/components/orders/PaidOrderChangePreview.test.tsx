import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { PaidOrderChangePreview } from './PaidOrderChangePreview';

vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('react-native', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: ({ accessibilityLabel }: { accessibilityLabel: string }) => (
    <input aria-label={accessibilityLabel} />
  ),
}));

it('shows the quoted increase and keeps receipt entry tied to the POS choice', () => {
  const selectMethod = vi.fn();
  const props: Parameters<typeof PaidOrderChangePreview>[0] = {
    preview: {
      previewId: 'preview',
      beforeLine: { name: 'Tecno Pop 10', quantity: 1 },
      afterLine: { name: 'Tecno Pop 20', quantity: 1 },
      beforeTotalMinor: 12986750,
      afterTotalMinor: 14986750,
      adjustmentMinor: 2000000,
      canRecordStaffTopUp: true,
    },
    formatPrice: (amount) => `₦${amount.toFixed(2)}`,
    action: (label, onClick) => (
      <button onClick={onClick} type="button">
        {label}
      </button>
    ),
    inputStyle: {},
    busy: false,
    canRefund: false,
    evidence: { id: '', select: vi.fn() },
    staffPayment: {
      method: null,
      selectMethod,
      receiptReference: '',
      setReceiptReference: vi.fn(),
    },
    reason: '',
    setReason: vi.fn(),
  };
  const { rerender } = render(<PaidOrderChangePreview {...props} />);
  expect(screen.getByText('Extra payment ₦20000.00')).toBeTruthy();
  expect(
    screen.queryByRole('textbox', { name: 'POS receipt reference' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'POS' }));
  expect(selectMethod).toHaveBeenCalledExactlyOnceWith('pos');
  rerender(
    <PaidOrderChangePreview
      {...props}
      staffPayment={{ ...props.staffPayment, method: 'pos' }}
    />
  );
  expect(
    screen.getByRole('textbox', { name: 'POS receipt reference' })
  ).toBeTruthy();
  rerender(
    <PaidOrderChangePreview
      {...props}
      preview={{
        ...props.preview,
        canRecordStaffTopUp: false,
        bankEvidence: [],
      }}
    />
  );
  expect(
    screen.getByText(
      'No matching payment has been verified. Finance must verify the incoming payment before this change can be confirmed.'
    )
  ).toBeTruthy();
});
