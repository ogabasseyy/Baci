import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NegotiationCardRequest } from './NegotiationCard';
import { NegotiationCard, type NegotiationCardColors } from './NegotiationCard';

vi.mock('@react-native-vector-icons/ionicons', () => ({
  Ionicons: () => null,
  default: () => null,
  __esModule: true,
}));

vi.mock('react-native', async () => {
  const React = await import('react');

  return {
    ActivityIndicator: () => React.createElement('span', null, 'Loading'),
    Pressable: ({
      accessibilityLabel,
      children,
      disabled,
      onPress,
    }: {
      accessibilityLabel?: string;
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
    }) =>
      React.createElement(
        'button',
        {
          'aria-label': accessibilityLabel,
          disabled,
          onClick: () => onPress?.(),
          type: 'button',
        },
        children
      ),
    StyleSheet: {
      create: (styles: Record<string, unknown>) => styles,
    },
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

function renderCard(
  item: NegotiationCardRequest,
  overrides: Partial<React.ComponentProps<typeof NegotiationCard>> = {}
) {
  const props: React.ComponentProps<typeof NegotiationCard> = {
    actionLoading: false,
    actionsDisabled: false,
    colors,
    expanded: false,
    item,
    onAction: vi.fn(),
    onOpenEvidence: vi.fn(),
    onOpenExternalUrl: vi.fn(),
    onToggleCart: vi.fn(),
    ...overrides,
  };

  render(<NegotiationCard {...props} />);
  return props;
}

const baseItem: NegotiationCardRequest = {
  id: 'negotiation-1',
  customer_id: null,
  type: 'single',
  status: 'pending',
  offered_price: 820_000,
  current_price: 875_000,
  item_info: {
    name: 'iPhone 14 Pro Max',
    current_price: 875_000,
    variant_attributes: {
      ram: '6GB',
      storage: '256GB',
      color: 'Deep Purple',
    },
    condition: 'used',
  },
  cart_snapshot: null,
  customer_email: null,
  customer_phone: '+2348031234567',
  created_at: '2026-07-01T08:00:00Z',
  evidence_url: 'merchant-1/evidence.png',
};

describe('NegotiationCard', () => {
  it('renders variant metadata and opens evidence/contact actions', () => {
    const onOpenEvidence = vi.fn();
    const onOpenExternalUrl = vi.fn();

    renderCard(baseItem, { onOpenEvidence, onOpenExternalUrl });

    expect(screen.getByText('RAM')).toBeInTheDocument();
    expect(screen.getByText('6GB')).toBeInTheDocument();
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('256GB')).toBeInTheDocument();
    expect(screen.getByText('Color')).toBeInTheDocument();
    expect(screen.getByText('Deep Purple')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('used')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'View customer evidence' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Call customer' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Message customer on WhatsApp' })
    );

    expect(onOpenEvidence).toHaveBeenCalledWith('merchant-1/evidence.png');
    expect(onOpenExternalUrl).toHaveBeenCalledWith('tel:+2348031234567');
    expect(onOpenExternalUrl).toHaveBeenCalledWith(
      expect.stringContaining('wa.me')
    );
  });

  it('renders expanded cart snapshot lines and forwards status actions', () => {
    const onAction = vi.fn();
    renderCard(
      {
        ...baseItem,
        type: 'total',
        item_info: { name: 'Cart Negotiation' },
        cart_snapshot: [
          {
            product_id: 'product-1',
            name: 'Dell Latitude',
            price: 450_000,
            quantity: 2,
            variant_id: 'variant-1',
            variant_name: '16GB / 512GB',
            condition: 'used',
          },
        ],
      },
      { expanded: true, onAction }
    );

    expect(screen.getByText('Dell Latitude')).toBeInTheDocument();
    expect(screen.getByText('Variant')).toBeInTheDocument();
    expect(screen.getByText('16GB / 512GB')).toBeInTheDocument();
    expect(screen.getByText('Condition')).toBeInTheDocument();
    expect(screen.getByText('used')).toBeInTheDocument();

    expect(screen.getByText('Bulk Cart')).toBeInTheDocument();
    expect(screen.getByText('-6%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept Offer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onAction).toHaveBeenCalledWith('negotiation-1', 'accepted');
    expect(onAction).toHaveBeenCalledWith('negotiation-1', 'rejected');
  });

  it('omits metadata when no variant or condition details exist', () => {
    renderCard({
      ...baseItem,
      item_info: { name: 'Wireless Headphones' },
      customer_phone: null,
      evidence_url: null,
    });

    expect(screen.getByText('Wireless Headphones')).toBeInTheDocument();
    expect(screen.queryByText(/Condition:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View customer evidence' })
    ).not.toBeInTheDocument();
  });

  it('renders a captured email and opens a prefilled email draft', () => {
    const onOpenExternalUrl = vi.fn();
    renderCard(
      {
        ...baseItem,
        customer_email: ' Buyer@Example.COM ',
        customer_phone: null,
      },
      { onOpenExternalUrl }
    );

    expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Email customer' }));

    expect(onOpenExternalUrl).toHaveBeenCalledWith(
      'mailto:buyer@example.com?subject=Negotiation%20follow-up%3A%20iPhone%2014%20Pro%20Max&body=Hi!%20About%20your%20negotiation%20offer%20on%20iPhone%2014%20Pro%20Max%20%E2%80%94'
    );
  });

  it('warns when no phone, email, or customer account is available', () => {
    renderCard({
      ...baseItem,
      customer_email: null,
      customer_id: null,
      customer_phone: null,
      evidence_url: null,
    });

    expect(
      screen.getByText(
        'No delivery channel captured. The customer will not be notified when this request is resolved.'
      )
    ).toBeInTheDocument();
  });
});
