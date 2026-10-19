import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WALLET_FUNDING_TELEMETRY } from '@/lib/posthog/wallet-funding-events';
import { UtilityWalletFundingPanel } from './UtilityWalletFundingPanel';

const { capturedProps, mockUseOptionalCustomerAuth } = vi.hoisted(() => ({
  capturedProps: { current: null as Record<string, unknown> | null },
  mockUseOptionalCustomerAuth: vi.fn(),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useOptionalCustomerAuth: mockUseOptionalCustomerAuth,
}));

vi.mock('./WalletFundingPanel', () => ({
  WalletFundingPanel: (props: Record<string, unknown>) => {
    capturedProps.current = props;
    const onUpdateCustomerPhone = props.onUpdateCustomerPhone as
      | ((phone: string) => Promise<unknown>)
      | undefined;
    const onUpdateCustomerName = props.onUpdateCustomerName as
      | ((firstName: string, lastName: string) => Promise<unknown>)
      | undefined;

    return (
      <>
        <button
          type="button"
          onClick={() => void onUpdateCustomerPhone?.('08012345678')}
        >
          Update phone
        </button>
        <button
          type="button"
          onClick={() => void onUpdateCustomerName?.('Jane', 'Doe')}
        >
          Update name
        </button>
      </>
    );
  },
}));

const baseProps = {
  account: null,
  merchantSlug: 'ogabassey',
  onAccountCreated: vi.fn(),
  requiresConsent: true,
  surface: WALLET_FUNDING_TELEMETRY.surfaces.utilityModal,
};

describe('UtilityWalletFundingPanel', () => {
  beforeEach(() => {
    capturedProps.current = null;
    mockUseOptionalCustomerAuth.mockReset();
  });

  it('forwards the authenticated customer phone update callback', async () => {
    const user = userEvent.setup();
    const updateCustomer = vi.fn().mockResolvedValue({ success: true });
    mockUseOptionalCustomerAuth.mockReturnValue({ updateCustomer });

    render(<UtilityWalletFundingPanel {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Update phone' }));

    expect(updateCustomer).toHaveBeenCalledWith({ phone: '08012345678' });
  });

  it('does not provide a phone update callback without customer auth', () => {
    mockUseOptionalCustomerAuth.mockReturnValue(null);

    render(<UtilityWalletFundingPanel {...baseProps} />);

    expect(capturedProps.current?.onUpdateCustomerPhone).toBeUndefined();
    expect(capturedProps.current?.onUpdateCustomerName).toBeUndefined();
  });

  it('forwards the authenticated customer name update callback', async () => {
    const user = userEvent.setup();
    const updateCustomer = vi.fn().mockResolvedValue({ success: true });
    mockUseOptionalCustomerAuth.mockReturnValue({ updateCustomer });

    render(<UtilityWalletFundingPanel {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Update name' }));

    expect(updateCustomer).toHaveBeenCalledWith({
      first_name: 'Jane',
      last_name: 'Doe',
    });
  });
});
