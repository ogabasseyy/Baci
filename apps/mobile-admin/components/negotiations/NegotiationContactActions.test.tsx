import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  NegotiationCardColors,
  NegotiationCardRequest,
} from './NegotiationCard';
import { NegotiationContactActions } from './NegotiationContactActions';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    Pressable: ({
      accessibilityLabel,
      children,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        { 'aria-label': accessibilityLabel, onClick: () => onPress?.() },
        children
      ),
    StyleSheet: { create: (styles: Record<string, unknown>) => styles },
    Text: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
    View: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

const colors: NegotiationCardColors = {
  backgroundLight: '#0f172a',
  border: '#334155',
  card: '#111827',
  error: '#ef4444',
  errorLight: '#fee2e2',
  primary: '#60a5fa',
  success: '#22c55e',
  successLight: '#dcfce7',
  text: '#f8fafc',
  textOnPrimary: '#ffffff',
  textSecondary: '#94a3b8',
  warning: '#f59e0b',
  warningLight: '#fef3c7',
};

const baseItem = {
  id: 'negotiation-1',
  customer_id: null,
  type: 'single' as const,
  status: 'pending' as const,
  offered_price: 820_000,
  current_price: 875_000,
  item_info: { name: 'Meta Quest 3 512GB' },
  cart_snapshot: null,
  customer_email: null,
  customer_phone: null,
  created_at: '2026-08-10T06:12:04.000Z',
  evidence_url: null,
} satisfies NegotiationCardRequest;

function renderContact(
  item: NegotiationCardRequest,
  onOpenExternalUrl = vi.fn()
) {
  render(
    <NegotiationContactActions
      colors={colors}
      item={item}
      onOpenExternalUrl={onOpenExternalUrl}
    />
  );
  return onOpenExternalUrl;
}

describe('NegotiationContactActions', () => {
  it('opens a captured email in a prefilled draft', () => {
    const onOpenExternalUrl = renderContact({
      ...baseItem,
      customer_email: ' Buyer@Example.COM ',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Email customer' }));

    expect(onOpenExternalUrl).toHaveBeenCalledWith(
      'mailto:buyer@example.com?subject=Negotiation%20follow-up%3A%20Meta%20Quest%203%20512GB&body=Hi!%20About%20your%20negotiation%20offer%20on%20Meta%20Quest%203%20512GB%20%E2%80%94'
    );
  });

  it('warns when the request has no delivery channel', () => {
    renderContact(baseItem);

    expect(
      screen.getByText(
        'No delivery channel captured. The customer will not be notified when this request is resolved.'
      )
    ).toBeInTheDocument();
  });
});
