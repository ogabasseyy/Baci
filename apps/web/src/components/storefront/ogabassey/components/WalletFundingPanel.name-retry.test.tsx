import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletFundingPanel } from './WalletFundingPanel';
import { walletFundingAccount as account } from './wallet-funding-panel-test-fixtures';

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());
const mockCaptureClientEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: mockCaptureClientEvent,
}));

describe('WalletFundingPanel name recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects both names after the API rejects an incomplete customer name', async () => {
    const user = userEvent.setup();
    const onAccountCreated = vi.fn();
    const onUpdateCustomerName = vi.fn().mockResolvedValue({ success: true });
    mockFetchWithCsrf
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          code: 'CUSTOMER_NAME_REQUIRED',
          error: 'Add your first and last name before creating a wallet transfer account',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ account, requiresConsent: false }),
      });

    render(
      <WalletFundingPanel
        account={null}
        customerFirstName={null}
        customerLastName={null}
        merchantSlug="ogabassey"
        onAccountCreated={onAccountCreated}
        onUpdateCustomerName={onUpdateCustomerName}
        requiresConsent={true}
        surface="utility_modal"
      />
    );

    await user.click(
      screen.getByRole('button', { name: /get my account number/i })
    );
    await user.type(
      await screen.findByRole('textbox', { name: /first name/i }),
      'Jane'
    );
    await user.type(
      screen.getByRole('textbox', { name: /last name/i }),
      'Doe'
    );
    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => {
      expect(onUpdateCustomerName).toHaveBeenCalledWith('Jane', 'Doe');
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(2);
      expect(onAccountCreated).toHaveBeenCalledWith(account);
    });
  });
});
