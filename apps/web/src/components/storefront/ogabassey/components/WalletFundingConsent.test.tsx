import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WALLET_FUNDING_COPY } from './wallet-funding-copy';
import { WalletFundingConsent } from './WalletFundingConsent';

describe('WalletFundingConsent', () => {
  it('explains unavailable funding and keeps the CTA disabled', () => {
    render(
      <WalletFundingConsent
        creating={false}
        merchantSlug="ogabassey"
        needsPhone={true}
        onCreate={vi.fn()}
        showUnavailable={true}
      />
    );

    expect(screen.getByText(WALLET_FUNDING_COPY.unavailable)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: WALLET_FUNDING_COPY.consentCta })
    ).toBeDisabled();
  });

  it('enables and submits the CTA when prerequisites are available', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <WalletFundingConsent
        creating={false}
        merchantSlug="ogabassey"
        needsPhone={false}
        onCreate={onCreate}
        showUnavailable={false}
      />
    );

    const button = screen.getByRole('button', {
      name: WALLET_FUNDING_COPY.consentCta,
    });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
