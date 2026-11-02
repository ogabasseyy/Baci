import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OrderGiglExternalWaybill } from '@/hooks/orders/useOrderGiglExternalWaybill';
import type { GiglExternalWaybillPreview } from '@/schemas/gigl-external-waybill';
import { ShipmentFlowGiglWaybillPanel } from './ShipmentFlowGiglWaybillPanel';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      backgroundLight: '#eee',
      border: '#ddd',
      card: '#fff',
      error: '#d00',
      primary: '#06f',
      primaryLight: '#def',
      text: '#111',
      textMuted: '#777',
      textSecondary: '#555',
    },
  }),
}));

vi.mock('@react-native-vector-icons/ionicons', () => ({
  default: () => null,
  __esModule: true,
}));

const matchingPreview: GiglExternalWaybillPreview = {
  waybill: '1349639588',
  linkable: true,
  match: { name: 'match', phone: 'match', destination: 'match' },
  order: { customerName: 'Audu Emmanuel', orderNumber: 'ORD-1' },
  gig: {
    receiverName: 'Audu Emmanuel',
    receiverPhoneLast4: '8805',
    destinationState: 'EBONYI',
    deliveryType: 'station',
    stationAddress: 'ABAKALIKI (CENTRAL PARK)',
    trackingStatus: 'In Transit',
    lastUpdate: {
      description: 'Shipment Arrives Collation Center',
      location: 'LAGOS GATEWAY',
      at: '2026-10-31T19:55:27.840Z',
    },
  },
};

function externalWaybill(
  overrides: Partial<OrderGiglExternalWaybill> = {}
): OrderGiglExternalWaybill {
  return {
    check: vi.fn(),
    error: null,
    link: vi.fn(),
    preview: null,
    reset: vi.fn(),
    setWaybill: vi.fn(),
    state: 'idle',
    waybill: '',
    ...overrides,
  };
}

describe('ShipmentFlowGiglWaybillPanel', () => {
  it('offers the option and asks for the waybill only once selected', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ShipmentFlowGiglWaybillPanel
        externalWaybill={externalWaybill()}
        onSelect={onSelect}
        selected={false}
      />
    );
    expect(screen.getByText('Already booked on GIG?')).toBeTruthy();
    expect(screen.queryByLabelText('GIG waybill number')).toBeNull();

    fireEvent.click(screen.getByRole('radio'));
    expect(onSelect).toHaveBeenCalledTimes(1);

    const state = externalWaybill();
    rerender(
      <ShipmentFlowGiglWaybillPanel
        externalWaybill={state}
        onSelect={onSelect}
        selected
      />
    );
    fireEvent.change(screen.getByLabelText('GIG waybill number'), {
      target: { value: '1349639588' },
    });
    expect(state.setWaybill).toHaveBeenCalledWith('1349639588');
  });

  it('shows who the parcel is for and that it matches the order', () => {
    render(
      <ShipmentFlowGiglWaybillPanel
        externalWaybill={externalWaybill({
          preview: matchingPreview,
          state: 'preview',
          waybill: '1349639588',
        })}
        onSelect={vi.fn()}
        selected
      />
    );
    expect(
      screen.getByLabelText('Receiver: Audu Emmanuel, matches the order')
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Phone: •••• 8805, matches the order')
    ).toBeTruthy();
    expect(screen.getByText(/Pickup at GIG centre/)).toBeTruthy();
    expect(screen.getByText(/In Transit · Shipment Arrives/)).toBeTruthy();
    expect(screen.getByText(/No wallet charge/)).toBeTruthy();
  });

  it('explains a destination mismatch', () => {
    render(
      <ShipmentFlowGiglWaybillPanel
        externalWaybill={externalWaybill({
          preview: {
            ...matchingPreview,
            linkable: false,
            match: { ...matchingPreview.match, destination: 'mismatch' },
          },
          state: 'preview',
        })}
        onSelect={vi.fn()}
        selected
      />
    );
    expect(
      screen.getByLabelText('Destination: EBONYI, does not match the order')
    ).toBeTruthy();
    expect(
      screen.getByText(/destination on this waybill does not match/)
    ).toBeTruthy();
  });

  it('hides GIG receiver details when the parcel is for someone else', () => {
    render(
      <ShipmentFlowGiglWaybillPanel
        externalWaybill={externalWaybill({
          preview: { ...matchingPreview, linkable: false, gig: null },
          state: 'preview',
        })}
        onSelect={vi.fn()}
        selected
      />
    );
    expect(
      screen.getByText(/does not match this order's customer/)
    ).toBeTruthy();
    expect(screen.queryByText('Audu Emmanuel')).toBeNull();
  });

  it('shows progress and server errors', () => {
    const { rerender } = render(
      <ShipmentFlowGiglWaybillPanel
        externalWaybill={externalWaybill({ state: 'checking' })}
        onSelect={vi.fn()}
        selected
      />
    );
    expect(screen.getByText('Checking with GIG Logistics…')).toBeTruthy();

    rerender(
      <ShipmentFlowGiglWaybillPanel
        externalWaybill={externalWaybill({
          error: 'This waybill was not booked on your GIG Logistics account.',
        })}
        onSelect={vi.fn()}
        selected
      />
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'not booked on your GIG Logistics account'
    );
  });
});
