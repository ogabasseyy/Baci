import { json } from '../../fixture-response';
export async function POST(request: Request) {
  await request.json().catch(() => ({}));
  const quote = {
    id: 'fixture-door',
    provider: 'GIGL',
    serviceTier: 'Standard',
    carrierName: 'GIG Logistics',
    displayName: 'GIG Logistics - Standard',
    estimatedDays: 1,
    price: 0,
    currency: 'NGN',
    pickupIncluded: false,
    insuranceIncluded: false,
    isStationPickup: false,
  };
  return json({
    quotes: { featured: [quote], all: [quote] },
    sessionId: 'fixture-shipping-session',
    warnings: [],
  });
}
