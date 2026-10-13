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

describe('WalletFundingPanel phone retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries a manual creation after saving a phone required by the API', async () => {
    const user = userEvent.setup();
    const onAccountCreated = vi.fn();
    const onUpdateCustomerPhone = vi.fn().mockResolvedValue({ success: true });
    mockFetchWithCsrf
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          code: 'CUSTOMER_PHONE_REQUIRED',
          error: 'A phone number is required',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ account, requiresConsent: false }),
      });

    render(
      <WalletFundingPanel
        account={null}
        customerPhone="08000000000"
        merchantSlug="ogabassey"
        onAccountCreated={onAccountCreated}
        onUpdateCustomerPhone={onUpdateCustomerPhone}
        requiresConsent={true}
        surface="utility_modal"
      />
    );

    await user.click(
      screen.getByRole('button', { name: /get my account number/i })
    );
    await user.type(
      await screen.findByRole('textbox', { name: /phone number/i }),
      '08012345678'
    );
    await user.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => {
      expect(onUpdateCustomerPhone).toHaveBeenCalledWith('08012345678');
      expect(mockFetchWithCsrf).toHaveBeenCalledTimes(2);
      expect(onAccountCreated).toHaveBeenCalledWith(account);
    });
  });
});
