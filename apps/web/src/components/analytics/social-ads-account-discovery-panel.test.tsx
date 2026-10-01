import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SocialAdsAccountDiscoveryPanel } from './social-ads-account-discovery-panel';

const account = {
  accountId: 'act_123',
  currencyCode: 'NGN',
  label: 'Baci Meta',
  selected: true,
  timezoneName: 'Africa/Lagos',
};

describe('SocialAdsAccountDiscoveryPanel', () => {
  it('offers accessible retry and cancel actions for discovery errors', () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();

    render(
      <SocialAdsAccountDiscoveryPanel
        accounts={[]}
        displayName="Meta Ads"
        error="Meta account discovery failed"
        isChoosing
        isDiscoveryError
        isLoading={false}
        isSaving={false}
        onCancel={onCancel}
        onRetry={onRetry}
        onSave={vi.fn()}
        onSelect={vi.fn()}
        provider="meta_ads"
        selectedId={null}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Retry account discovery' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry account discovery' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps action errors visible without exposing discovery actions', () => {
    render(
      <SocialAdsAccountDiscoveryPanel
        accounts={[account]}
        displayName="Meta Ads"
        error="Account selection failed"
        isChoosing
        isDiscoveryError={false}
        isLoading={false}
        isSaving={false}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        onSelect={vi.fn()}
        provider="meta_ads"
        selectedId={account.accountId}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Account selection failed'
    );
    expect(
      screen.queryByRole('button', { name: 'Retry account discovery' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('offers an exit when discovery succeeds without accessible accounts', () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();

    render(
      <SocialAdsAccountDiscoveryPanel
        accounts={[]}
        displayName="Snapchat Ads"
        error={null}
        isChoosing
        isDiscoveryError={false}
        isLoading={false}
        isSaving={false}
        onCancel={onCancel}
        onRetry={onRetry}
        onSave={vi.fn()}
        onSelect={vi.fn()}
        provider="snapchat_ads"
        selectedId={null}
      />
    );

    expect(
      screen.getByText('No accessible Snapchat Ads accounts were found.')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry account discovery' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('offers an exit after discovering accessible accounts', () => {
    const onCancel = vi.fn();

    render(
      <SocialAdsAccountDiscoveryPanel
        accounts={[account]}
        displayName="TikTok Ads"
        error={null}
        isChoosing
        isDiscoveryError={false}
        isLoading={false}
        isSaving={false}
        onCancel={onCancel}
        onRetry={vi.fn()}
        onSave={vi.fn()}
        onSelect={vi.fn()}
        provider="tiktok_ads"
        selectedId={account.accountId}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
