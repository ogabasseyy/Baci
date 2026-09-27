import { json } from '../../fixture-response';
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const pickup = body.deliveryPreference === 'pickup_station';
  return json({
    quotes: [
      {
        id: pickup ? 'fixture-pickup' : 'fixture-door',
        provider: 'fixture',
        service_name: pickup ? 'Store Pickup' : 'Standard Delivery',
        price: 0,
        currency: 'NGN',
        estimated_days: 'Same day',
        isStationPickup: pickup,
        pickupLocation: pickup ? 'Ogabassey Ikeja' : undefined,
      },
    ],
  });
}
