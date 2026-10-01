import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentFlowMethodStep } from './ShipmentFlowMethodStep';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => (
    <span aria-label={name} role="img" />
  ),
  default: ({ name }: { name: string }) => (
    <span aria-label={name} role="img" />
  ),
  __esModule: true,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StyleSheet: {
      create: (styles: unknown) => styles,
    },
    Pressable: ({
      accessibilityLabel,
      accessibilityState,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      accessibilityState?: { checked?: boolean; disabled?: boolean };
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-checked': accessibilityState?.checked,
          'aria-disabled': disabled || accessibilityState?.disabled,
          'aria-label': accessibilityLabel,
          disabled,
          onClick: onPress,
          role: 'radio',
          type: 'button',
        },
        children
      ),
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({
      accessibilityRole,
      children,
    }: {
      accessibilityRole?: string;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        'div',
        accessibilityRole ? { role: accessibilityRole } : null,
        children
      ),
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      backgroundLight: '#f8fafc',
      border: '#e2e8f0',
      card: '#ffffff',
      primary: '#2563eb',
      primaryLight: '#dbeafe',
      text: '#0f172a',
      textSecondary: '#64748b',
    },
  }),
}));

describe('ShipmentFlowMethodStep', () => {
  it('renders the injected GIGL panel instead of the provider fallback option', () => {
    const onModeChange = vi.fn();

    render(
      <ShipmentFlowMethodStep
        canUseProvider
        giglPanel={<div>GIGL wallet panel</div>}
        onModeChange={onModeChange}
        providerLabel="GIGL"
        selectedMode="self_fulfillment"
      />
    );

    expect(screen.getByText('GIGL wallet panel')).toBeInTheDocument();
    expect(screen.queryByText('Use GIGL')).not.toBeInTheDocument();
    expect(screen.getByText('Self Fulfill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Self Fulfill/i }));
    expect(onModeChange).toHaveBeenCalledWith('self_fulfillment');
  });

  it('falls back to the provider option card when no GIGL panel is injected', () => {
    const onModeChange = vi.fn();

    render(
      <ShipmentFlowMethodStep
        canUseProvider
        onModeChange={onModeChange}
        providerLabel="Topship"
        selectedMode="provider"
      />
    );

    expect(screen.getByText('Use Topship')).toBeInTheDocument();
    expect(
      screen.getByText(
        /book the shipment with Topship using the saved checkout quote/i
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Use Topship/i }));
    expect(onModeChange).toHaveBeenCalledWith('provider');
  });

  it('disables the provider fallback when the order cannot use a provider quote', () => {
    render(
      <ShipmentFlowMethodStep
        canUseProvider={false}
        onModeChange={vi.fn()}
        providerLabel="GIGL"
        selectedMode="self_fulfillment"
      />
    );

    expect(screen.getByRole('radio', { name: /Use GIGL/i })).toBeDisabled();
    expect(
      screen.getByText(/does not have a saved quote to book against anymore/i)
    ).toBeInTheDocument();
  });
});
