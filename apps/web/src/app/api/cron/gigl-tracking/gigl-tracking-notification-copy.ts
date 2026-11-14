const notificationCopy: Record<string, { title: string; body: string }> = {
  delivered: { title: 'Order delivered', body: 'Your delivery has arrived.' },
  out_for_delivery: {
    title: 'Out for delivery',
    body: 'Your order is on its way.',
  },
  picked_up: {
    title: 'Order picked up',
    body: 'GIG Logistics has collected the parcel.',
  },
  pickup_assigned: {
    title: 'Pickup scheduled',
    body: 'GIG Logistics will collect the parcel.',
  },
  pickup_en_route: {
    title: 'Rider en route',
    body: 'A GIG Logistics rider is heading to pickup.',
  },
  pickup_delayed: {
    title: 'Pickup delayed',
    body: 'Your GIG Logistics pickup is taking longer than expected.',
  },
  transit_started: {
    title: 'Order in transit',
    body: 'Your order is moving through GIG Logistics.',
  },
  arrived_in_city: {
    title: 'Arrived in your city',
    body: 'Your order has reached your delivery city. We will update you on the next step.',
  },
  delivery_attempt_failed: {
    title: 'Delivery attempt unsuccessful',
    body: 'GIG Logistics could not complete the delivery attempt.',
  },
  return_in_progress: {
    title: 'Order being returned',
    body: 'GIG Logistics is returning your order to the sender.',
  },
  shipment_exception: {
    title: 'Shipment exception',
    body: 'GIG Logistics reported an issue with your shipment.',
  },
  failed: {
    title: 'Delivery issue',
    body: 'GIG Logistics reported a delivery issue.',
  },
  returned: {
    title: 'Order returned',
    body: 'GIG Logistics has returned the order to the sender.',
  },
  cancelled: {
    title: 'Shipment cancelled',
    body: 'The GIG Logistics shipment has been cancelled.',
  },
};

type Audience = 'merchant' | 'customer';

const audienceCopy: Record<
  Audience,
  Record<string, { title: string; body: string }>
> = {
  customer: {
    picked_up: {
      title: 'Your order has shipped',
      body: 'GIG Logistics has collected your parcel. Track it any time.',
    },
    cancelled: {
      title: 'Shipment cancelled',
      body: 'The shipment for your order was cancelled.',
    },
    waybill_changed: {
      title: 'Your tracking number changed',
      body: 'Your order has a new tracking number. Use the new link to follow it.',
    },
  },
  merchant: {
    delivered: {
      title: 'Sale complete',
      body: 'The order was delivered to your customer.',
    },
    out_for_delivery: {
      title: 'Out for delivery',
      body: 'A GIG Logistics rider is delivering the order.',
    },
    pickup_delayed: {
      title: 'GIG pickup delayed',
      body: 'Your GIG Logistics pickup is taking longer than expected.',
    },
    waybill_changed: {
      title: 'GIG waybill updated',
      body: 'The shipment now uses a new GIG waybill.',
    },
  },
};

export function copyFor(
  kind: string,
  description: string,
  audience?: Audience
) {
  return (
    (audience ? audienceCopy[audience][kind] : undefined) ??
    notificationCopy[kind] ?? {
      title: 'Shipment update',
      body: description || 'Your shipment has a new update.',
    }
  );
}
