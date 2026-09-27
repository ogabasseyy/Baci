import { reuseCheckoutOrderSchema } from '@/schemas/orders';
import { order } from '../../../../../setup';
import { hasValidFixtureCsrf } from '../../fixture-csrf';
import { json } from '../../fixture-response';
export async function POST(request: Request) {
  if (!hasValidFixtureCsrf(request))
    return json({ error: 'Fixture CSRF validation failed' }, 403);
  const body = await request.json().catch(() => null);
  if (!reuseCheckoutOrderSchema.safeParse(body).success)
    return json({ error: 'Invalid fixture order reuse request' }, 400);
  return json({ order });
}
