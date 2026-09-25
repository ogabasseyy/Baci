import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ConnectJumiaManualForm,
  getJumiaShopSelectionId,
} from './connect-jumia-manual-form';

describe('getJumiaShopSelectionId', () => {
  it('prefers the selection key when present', () => {
    expect(
      getJumiaShopSelectionId({
        id: 'shop-1',
        selectionKey: 'shop-1:NG',
        name: 'Shop',
        countryCode: 'NG',
        marketplace: 'Jumia',
        alreadyConnected: false,
      })
    ).toBe('shop-1:NG');
  });
});

describe('ConnectJumiaManualForm', () => {
  it('masks the self-authorization refresh token input', () => {
    render(
      <ConnectJumiaManualForm
        clientId="client-id"
        refreshToken="refresh-token"
        discovering={false}
        canResumeDiscovery={false}
        connecting={false}
        discoveredShops={[]}
        selectedShopIds={new Set()}
        onClientIdChange={vi.fn()}
        onRefreshTokenChange={vi.fn()}
        onDiscover={vi.fn()}
        onConnectSelected={vi.fn()}
        onToggleShop={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Refresh Token')).toHaveAttribute(
      'type',
      'password'
    );
  });

  it('allows retrying discovery from a saved handle without the rotated token', () => {
    render(
      <ConnectJumiaManualForm
        clientId="client-id"
        refreshToken=""
        discovering={false}
        canResumeDiscovery={true}
        connecting={false}
        discoveredShops={[]}
        selectedShopIds={new Set()}
        onClientIdChange={vi.fn()}
        onRefreshTokenChange={vi.fn()}
        onDiscover={vi.fn()}
        onConnectSelected={vi.fn()}
        onToggleShop={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Discover shops' })
    ).toBeEnabled();
  });
});
