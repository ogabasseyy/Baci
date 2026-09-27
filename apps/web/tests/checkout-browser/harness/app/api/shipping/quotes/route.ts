import { QuoteRequestSchema } from '@/schemas/shipping';
import { shippingQuoteId } from '../../../../../fixtures';
import { json } from '../../fixture-response';
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!QuoteRequestSchema.safeParse(body).success)
    return json({ error: 'Invalid fixture shipping quote request' }, 400);
  const quote = {
    id: shippingQuoteId,
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
