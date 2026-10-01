import { formatDeliveryMetadataLabel } from '@baci/shared';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Order } from '../actions';

type ShipmentDetailsOrder = Pick<
  Order,
  | 'airport_type'
  | 'delivery_method'
  | 'shipping_pickup_details'
  | 'shipping_provider'
  | 'shipping_rate_name'
  | 'tracking_number'
>;

export function ShipmentDetailsCard({
  order,
}: {
  order: ShipmentDetailsOrder;
}) {
  const shippingMethodLabel =
    order.shipping_rate_name || order.shipping_provider || null;
  const shippingMethodHeading = order.shipping_rate_name
    ? 'Shipping Method'
    : 'Provider';
  const deliveryMethodLabel =
    order.delivery_method === 'airport'
      ? order.airport_type === 'pickup'
        ? 'Airport Pickup'
        : 'Airport Delivery'
      : formatDeliveryMetadataLabel(order.delivery_method);
  const airportTypeLabel =
    order.delivery_method === 'airport'
      ? formatDeliveryMetadataLabel(order.airport_type)
      : null;

  const pickupDetails =
    order.shipping_provider === 'MERCHANT_PICKUP'
      ? order.shipping_pickup_details
      : null;
  const pickupLabel = pickupDetails?.label?.trim() || '';
  const pickupAddressLine = pickupDetails
    ? [pickupDetails.address, pickupDetails.city, pickupDetails.state]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(', ')
    : '';
  const pickupInstructions = pickupDetails?.instructions?.trim() || '';
  const hasPickupDetails = Boolean(
    pickupLabel || pickupAddressLine || pickupInstructions
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shipment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {deliveryMethodLabel && (
          <div>
            <p className="text-sm text-muted-foreground">Delivery Method</p>
            <p className="font-semibold">{deliveryMethodLabel}</p>
          </div>
        )}
        {airportTypeLabel && (
          <div>
            <p className="text-sm text-muted-foreground">Airport Type</p>
            <p className="font-semibold">{airportTypeLabel}</p>
          </div>
        )}
        {shippingMethodLabel && (
          <div>
            <p className="text-sm text-muted-foreground">
              {shippingMethodHeading}
            </p>
            <p className="font-semibold">{shippingMethodLabel}</p>
          </div>
        )}
        {hasPickupDetails && (
          <div>
            <p className="text-sm text-muted-foreground">Pickup Location</p>
            {pickupLabel && <p className="font-semibold">{pickupLabel}</p>}
            {pickupAddressLine && (
              <p className="text-sm">{pickupAddressLine}</p>
            )}
            {pickupInstructions && (
              <p className="text-sm text-muted-foreground">
                {pickupInstructions}
              </p>
            )}
          </div>
        )}
        {order.tracking_number ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Tracking #</p>
              <p className="font-semibold">{order.tracking_number}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/track/${order.tracking_number}`}>Track</Link>
            </Button>
          </div>
        ) : (
          !shippingMethodLabel &&
          !deliveryMethodLabel &&
          !airportTypeLabel && (
            <p className="text-sm text-muted-foreground">
              No tracking information available.
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
