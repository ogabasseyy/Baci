import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderDetailsShippingSection } from './OrderDetailsShippingSection';

// Project-standard react-native shim: matches the minimal stub used across
// apps/mobile-admin component tests (see NewOrderChannelSection.test.tsx,
// RecordPaymentSheet.test.tsx). Keeps each test file self-contained so that
// adding or adjusting a component never requires editing a shared harness.
vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    StatusBar: () => null,
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({
      accessibilityLabel,
      accessibilityRole,
      children,
    }: {
      accessibilityLabel?: string;
      accessibilityRole?: string;
      children?: React.ReactNode;
    }) =>
      React.createElement(
        'div',
        {
          'aria-label': accessibilityLabel,
          role: accessibilityRole,
        },
        children
      ),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,

  default: () => null,
  __esModule: true,
}));

describe('OrderDetailsShippingSection', () => {
  const colors = {
    background: '#ffffff',
    border: '#e2e8f0',
    card: '#ffffff',
    text: '#0f172a',
    textSecondary: '#64748b',
  } as unknown as Parameters<typeof OrderDetailsShippingSection>[0]['colors'];

  it('renders the provided address string', () => {
    render(
      <OrderDetailsShippingSection
        address="12 Marina Street, Lagos Island, Lagos"
        colors={colors}
      />
    );

    expect(
      screen.getByText('12 Marina Street, Lagos Island, Lagos')
    ).toBeInTheDocument();
  });

  it('exposes accessibility label and role on the container', () => {
    render(
      <OrderDetailsShippingSection
        address="42 Allen Avenue, Ikeja, Lagos"
        colors={colors}
      />
    );

    const container = screen.getByLabelText('Shipping address');
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute('role', 'summary');
  });

  it('renders persisted airport metadata for fulfillment', () => {
    render(
      <OrderDetailsShippingSection
        address="12 Marina Street, Lagos Island, Lagos"
        airportType="delivery"
        colors={colors}
        deliveryMethod="airport"
      />
    );

    expect(screen.getByText('Delivery Method')).toBeInTheDocument();
    expect(screen.getByText('Airport Delivery')).toBeInTheDocument();
    expect(screen.getByText('Airport Type')).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
  });

  it('labels airport pickup orders as pickup', () => {
    render(
      <OrderDetailsShippingSection
        address="12 Marina Street, Lagos Island, Lagos"
        airportType="pickup"
        colors={colors}
        deliveryMethod="airport"
      />
    );

    expect(screen.getByText('Airport Pickup')).toBeInTheDocument();
    expect(screen.getByText('Airport Type')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.queryByText('Airport Delivery')).not.toBeInTheDocument();
  });
});
