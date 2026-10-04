import { cartValidateSchema } from '@/schemas/cart';
import { hasValidFixtureCsrf } from '../../fixture-csrf';
import { json } from '../../fixture-response';
export async function POST(request: Request) {
  if (!hasValidFixtureCsrf(request))
    return json({ error: 'Fixture CSRF validation failed' }, 403);
  const body = await request.json().catch(() => null);
  if (!cartValidateSchema.safeParse(body).success)
    return json({ error: 'Invalid fixture cart request' }, 400);
  return json({ invalidProductIds: [], priceChanges: [] });
}
