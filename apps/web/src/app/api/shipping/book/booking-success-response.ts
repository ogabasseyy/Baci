import { NextResponse } from 'next/server';
import type { ShipmentBookingResult } from '@/lib/shipping/types';

export function bookingSuccessResponse(
  shipmentId: string,
  result: ShipmentBookingResult
) {
  return NextResponse.json(
    {
      success: true,
      shipment: {
        id: shipmentId,
        trackingNumber: result.trackingNumber,
        providerShipmentId: result.providerShipmentId,
        carrier: result.carrierName,
        status: result.status,
        pickupScheduledAt: result.pickupScheduledAt,
        labelUrl: result.labelUrl,
      },
    },
    { status: 201 }
  );
}
