import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentDetailsCard } from './shipment-details-card';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

describe('ShipmentDetailsCard', () => {
  it('labels airport pickup separately from airport delivery', () => {
    render(
      <ShipmentDetailsCard
        order={{
          airport_type: 'pickup',
          delivery_method: 'airport',
          shipping_provider: 'GIGL',
        }}
      />
    );

    expect(screen.getByText('Airport Pickup')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.queryByText('Airport Delivery')).not.toBeInTheDocument();
  });

  it('renders a tracking link when a shipment has tracking', () => {
    render(
      <ShipmentDetailsCard
        order={{
          delivery_method: 'door',
          tracking_number: 'TRACK-1',
        }}
      />
    );

    expect(screen.getByRole('link', { name: 'Track' })).toHaveAttribute(
      'href',
      '/track/TRACK-1'
    );
  });
});
