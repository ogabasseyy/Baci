import { describe, expect, it } from 'vitest';
import { copyFor } from './gigl-tracking-notification-copy';

describe('GIGL tracking notification copy', () => {
  it('tells the customer their order reached their delivery city', () => {
    expect(copyFor('arrived_in_city', 'provider detail')).toEqual({
      title: 'Arrived in your city',
      body: 'Your order has reached your delivery city. We will update you on the next step.',
    });
  });

  it('uses explicit copy for provider lifecycle kinds', () => {
    expect(copyFor('pickup_delayed', 'provider detail')).toEqual({
      title: 'Pickup delayed',
      body: 'Your GIG Logistics pickup is taking longer than expected.',
    });
  });

  it('uses the event description only for unknown kinds', () => {
    expect(copyFor('unknown_kind', 'provider detail')).toEqual({
      title: 'Shipment update',
      body: 'provider detail',
    });
  });

  it('tells the customer their order has shipped at pickup', () => {
    expect(copyFor('picked_up', '', 'customer').title).toBe(
      'Your order has shipped'
    );
    expect(copyFor('picked_up', '', 'merchant').title).toBe('Order picked up');
  });

  it('calls a merchant delivery a completed sale', () => {
    expect(copyFor('delivered', '', 'merchant').title).toBe('Sale complete');
    expect(copyFor('delivered', '', 'customer').title).toBe('Order delivered');
  });

  it('titles the merchant delayed-pickup alert', () => {
    expect(copyFor('pickup_delayed', '', 'merchant').title).toBe(
      'GIG pickup delayed'
    );
  });

  it('announces a changed tracking number to both sides', () => {
    expect(copyFor('waybill_changed', '', 'customer').title).toBe(
      'Your tracking number changed'
    );
    expect(copyFor('waybill_changed', '', 'merchant').title).toBe(
      'GIG waybill updated'
    );
  });
});
