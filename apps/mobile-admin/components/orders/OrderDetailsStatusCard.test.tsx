import '@testing-library/jest-dom/vitest';
import { SHIPPING_STATUS_CONFIG } from '@baci/shared';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ThemeColors } from '@/constants/theme';
import { OrderDetailsStatusCard } from './OrderDetailsStatusCard';

vi.mock('react-native', async () => {
  const React = await import('react');
  const flattenStyle = (
    style: Record<string, unknown> | Record<string, unknown>[] | undefined
  ): Record<string, unknown> => {
    if (Array.isArray(style)) {
      const accumulator: Record<string, unknown> = {};
      for (const value of style) {
        Object.assign(accumulator, flattenStyle(value));
      }
      return accumulator;
    }

    return style ?? {};
  };

  return {
    StatusBar: () => null,
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({
      children,
      style,
    }: {
      children?: React.ReactNode;
      style?: Record<string, unknown> | Record<string, unknown>[];
    }) =>
      React.createElement(
        'div',
        { 'data-style': JSON.stringify(flattenStyle(style)) },
        children
      ),
  };
});

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-icon={name} />,

  default: ({ name }: { name: string }) => <span data-icon={name} />,
  __esModule: true,
}));

describe('OrderDetailsStatusCard', () => {
  const colors = {
    backgroundLight: '#172554',
    border: '#1e293b',
    cancelled: '#dc2626',
    card: '#0f172a',
    delivered: '#16a34a',
    inputBg: '#111827',
    pending: '#ca8a04',
    processing: '#2563eb',
    returned: '#9333ea',
    shipped: '#7c3aed',
    text: '#f8fafc',
    textMuted: '#94a3b8',
    textOnPrimary: '#ffffff',
    textSecondary: '#cbd5e1',
  } as unknown as ThemeColors;

  it('renders timeline labels and icons from each step config instead of reusing the current status config', () => {
    const { container } = render(
      <OrderDetailsStatusCard
        colors={colors}
        placedOnLabel="14 Mar 2023, 00:00"
        shippingColor="#2563eb"
        shippingConfig={SHIPPING_STATUS_CONFIG.shipped}
        shippingStatus="shipped"
        source="website"
        sourceInfo={{
          color: '#64748b',
          label: 'Website',
          name: 'globe-outline',
        }}
        updatedAtLabel="Apr 21, 2026"
      />
    );

    expect(screen.getByText('Unfulfilled')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(
      screen.getByText('Placed on 14 Mar 2023, 00:00')
    ).toBeInTheDocument();
    expect(screen.getByText('Latest update: Apr 21, 2026')).toBeInTheDocument();
    expect(screen.getAllByText('Shipped')).toHaveLength(2);
    expect(screen.getByText('Delivered')).toBeInTheDocument();

    const iconNames = Array.from(container.querySelectorAll('[data-icon]')).map(
      (node) => node.getAttribute('data-icon')
    );

    expect(iconNames).toEqual(
      expect.arrayContaining([
        'receipt-outline',
        'construct-outline',
        'car-outline',
        'checkmark-done-outline',
      ])
    );

    const viewStyles = Array.from(
      container.querySelectorAll('div[data-style]')
    ).map((node) => JSON.parse(node.getAttribute('data-style') ?? '{}'));

    const progressDots = viewStyles.filter(
      (style) => style.width === 28 && style.height === 28
    );
    const progressLines = viewStyles.filter(
      (style) => style.height === 3 && style.flex === 1
    );

    expect(
      progressDots.slice(0, 4).map((style) => style.backgroundColor)
    ).toEqual([
      colors.pending,
      colors.processing,
      colors.shipped,
      colors.inputBg,
    ]);
    expect(progressLines.map((style) => style.backgroundColor)).toEqual([
      colors.pending,
      colors.processing,
      colors.border,
    ]);
  });

  it('replaces the delivered step with the terminal returned status', () => {
    const { container } = render(
      <OrderDetailsStatusCard
        colors={colors}
        placedOnLabel="Apr 20, 2026"
        shippingColor={colors.returned}
        shippingConfig={SHIPPING_STATUS_CONFIG.returned}
        shippingStatus="returned"
        source="website"
        sourceInfo={{
          color: '#64748b',
          label: 'Website',
          name: 'globe-outline',
        }}
        updatedAtLabel="Apr 21, 2026"
      />
    );

    expect(screen.queryByText('Delivered')).not.toBeInTheDocument();
    expect(screen.getAllByText('Returned')).toHaveLength(2);

    const iconNames = Array.from(container.querySelectorAll('[data-icon]')).map(
      (node) => node.getAttribute('data-icon')
    );

    expect(iconNames).toEqual(
      expect.arrayContaining([
        'receipt-outline',
        'construct-outline',
        'car-outline',
        SHIPPING_STATUS_CONFIG.returned.icon,
      ])
    );

    const viewStyles = Array.from(
      container.querySelectorAll('div[data-style]')
    ).map((node) => JSON.parse(node.getAttribute('data-style') ?? '{}'));

    const progressDots = viewStyles.filter(
      (style) => style.width === 28 && style.height === 28
    );
    const progressLines = viewStyles.filter(
      (style) => style.height === 3 && style.flex === 1
    );

    expect(
      progressDots.slice(0, 4).map((style) => style.backgroundColor)
    ).toEqual([
      colors.pending,
      colors.processing,
      colors.shipped,
      colors.returned,
    ]);
    expect(progressLines.map((style) => style.backgroundColor)).toEqual([
      colors.pending,
      colors.processing,
      colors.shipped,
    ]);
  });

  it('treats fulfilled orders as delivered in the timeline', () => {
    const { container } = render(
      <OrderDetailsStatusCard
        colors={colors}
        placedOnLabel="Apr 20, 2026"
        shippingColor={colors.delivered}
        shippingConfig={SHIPPING_STATUS_CONFIG.delivered}
        shippingStatus="fulfilled"
        source="website"
        sourceInfo={{
          color: '#64748b',
          label: 'Website',
          name: 'globe-outline',
        }}
        updatedAtLabel="Apr 21, 2026"
      />
    );

    expect(screen.getAllByText('Delivered')).toHaveLength(2);

    const viewStyles = Array.from(
      container.querySelectorAll('div[data-style]')
    ).map((node) => JSON.parse(node.getAttribute('data-style') ?? '{}'));

    const progressDots = viewStyles.filter(
      (style) => style.width === 28 && style.height === 28
    );
    const progressLines = viewStyles.filter(
      (style) => style.height === 3 && style.flex === 1
    );

    expect(
      progressDots.slice(0, 4).map((style) => style.backgroundColor)
    ).toEqual([
      colors.pending,
      colors.processing,
      colors.shipped,
      colors.delivered,
    ]);
    expect(progressLines.map((style) => style.backgroundColor)).toEqual([
      colors.pending,
      colors.processing,
      colors.shipped,
    ]);
  });
});
