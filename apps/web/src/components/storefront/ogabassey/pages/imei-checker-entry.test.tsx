import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OgabasseyImeiEntry } from './imei-checker-entry';

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));

function renderEntry(overrides: Record<string, unknown> = {}) {
  const props = {
    brand: 'apple' as const,
    canToggleServices: true,
    device: 'smartphone' as const,
    deviceQuery: '',
    displayedTierKeys: ['full', 'activation', 'blacklist', 'carrier'] as const,
    error: null,
    identifier: 'imei' as const,
    imei: '354442067957452',
    isLoading: false,
    isPending: false,
    needsWalletFunding: false,
    onCheck: vi.fn((event: React.FormEvent) => event.preventDefault()),
    onDeviceQueryChange: vi.fn(),
    onDeviceSearchFocus: vi.fn(),
    onImeiChange: vi.fn(),
    onSelectBrand: vi.fn(),
    onSelectDevice: vi.fn(),
    onSelectDeviceSuggestion: vi.fn(),
    onSelectTier: vi.fn(),
    onToggleServices: vi.fn(),
    pendingPaused: false,
    searchLoading: false,
    selectedDeviceSuggestion: null,
    selectedTier: 'full' as const,
    showAllServices: false,
    showSuggestions: true,
    suggestions: [
      {
        category: 'Phones',
        id: 'p1',
        image: '/phone.png',
        name: 'iPhone 15 Pro',
      },
    ],
    ...overrides,
  };

  render(<OgabasseyImeiEntry {...props} />);
  return props;
}

describe('OgabasseyImeiEntry', () => {
  it('renders suggestions and selects a device', () => {
    const props = renderEntry();

    fireEvent.click(screen.getByRole('button', { name: /iphone 15 pro/i }));

    expect(props.onSelectDeviceSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', name: 'iPhone 15 Pro' })
    );
  });

  it('switches device category tabs', () => {
    const props = renderEntry();

    fireEvent.click(screen.getByRole('tab', { name: /ipad checks/i }));

    expect(props.onSelectDevice).toHaveBeenCalledWith('tablet');
  });

  it('shows brand chips on the smartphone tab', () => {
    renderEntry({ device: 'smartphone' });
    expect(screen.getByRole('radiogroup', { name: /brand/i })).toBeTruthy();
  });

  it('hides brand chips on non-smartphone tabs', () => {
    renderEntry({ device: 'tablet' });
    expect(
      screen.queryByRole('radiogroup', { name: /brand/i })
    ).not.toBeInTheDocument();
  });

  it('selects service tiers', () => {
    const props = renderEntry();

    fireEvent.click(
      screen.getByRole('radio', {
        name: /network check, will my sim work\?, ₦1,000/i,
      })
    );

    expect(props.onSelectTier).toHaveBeenCalledWith('carrier');
  });

  it('emits raw IMEI input changes', () => {
    const props = renderEntry({ imei: '' });

    fireEvent.change(screen.getByLabelText(/imei number/i), {
      target: { value: '354442067957452' },
    });

    expect(props.onImeiChange).toHaveBeenCalledWith('354442067957452');
  });

  it('submits valid IMEI checks', () => {
    const props = renderEntry();

    fireEvent.click(screen.getByRole('button', { name: /verify now/i }));

    expect(props.onCheck).toHaveBeenCalledOnce();
  });

  it('disables invalid checks', () => {
    renderEntry({ imei: '35444206795745' });

    expect(screen.getByRole('button', { name: /verify now/i })).toBeDisabled();
  });

  it('shows loading and error states', () => {
    renderEntry({
      error: 'Wallet balance is too low.',
      isLoading: true,
    });

    expect(screen.getByText('Wallet balance is too low.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verifying/i })).toBeDisabled();
  });

  it('labels text inputs for assistive technology', () => {
    renderEntry();

    expect(
      screen.getByRole('textbox', { name: /search for a device name/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /imei number/i })
    ).toBeInTheDocument();
  });

  it('uses a numeric mobile keyboard hint for IMEI-only tiers', () => {
    renderEntry();

    expect(
      screen.getByRole('textbox', { name: /imei number/i })
    ).toHaveAttribute('inputmode', 'numeric');
  });

  it('uses a text keyboard hint for serial-only tiers', () => {
    renderEntry({ identifier: 'serial', imei: '' });

    expect(
      screen.getByRole('textbox', { name: /serial number/i })
    ).toHaveAttribute('inputmode', 'text');
  });

  it('omits the LCP hero when the parent already committed it', () => {
    renderEntry({ omitHero: true });

    expect(
      screen.queryByRole('heading', { name: /Don't Get Scammed/i })
    ).not.toBeInTheDocument();
  });
});
