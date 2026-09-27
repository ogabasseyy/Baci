import { json } from '../../fixture-response';
export async function POST(request: Request) {
  await request.json().catch(() => ({}));
  const quote = {
    id: '55555555-5555-4555-8555-555555555555',
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
