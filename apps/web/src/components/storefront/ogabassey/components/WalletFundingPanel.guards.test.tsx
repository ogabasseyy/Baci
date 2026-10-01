import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletFundingPanel } from './WalletFundingPanel';

const mockCaptureClientEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: mockCaptureClientEvent,
}));

describe('WalletFundingPanel CTA guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [
      'phone persistence is unavailable',
      { customerPhone: '', merchantSlug: 'ogabassey' },
      true,
      true,
    ],
    [
      'merchant context is unresolved',
      { customerPhone: undefined, merchantSlug: undefined },
      true,
      false,
    ],
    [
      'phone and merchant context are available',
      { customerPhone: '08012345678', merchantSlug: 'ogabassey' },
      false,
      false,
    ],
  ])(
    'gates account creation when %s',
    (_reason, overrides, disabled, unavailable) => {
      render(
        <WalletFundingPanel
          account={null}
          merchantSlug={overrides.merchantSlug}
          customerPhone={overrides.customerPhone}
          onAccountCreated={vi.fn()}
          requiresConsent={true}
          surface="utility_modal"
        />
      );

      if (unavailable) {
        expect(
          screen.getByText(/bank transfer funding is not available/i)
        ).toBeInTheDocument();
      }

      const button = screen.getByRole('button', {
        name: /get my account number/i,
      });
      if (disabled) {
        expect(button).toBeDisabled();
      } else {
        expect(button).toBeEnabled();
      }
    }
  );
});
