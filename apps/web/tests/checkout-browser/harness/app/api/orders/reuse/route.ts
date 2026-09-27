import { reuseCheckoutOrderSchema } from '@/schemas/orders';
import { merchant } from '../../../../../fixtures';
import { order } from '../../../../../setup';
import { hasValidFixtureCsrf } from '../../fixture-csrf';
import { fixtureCustomerEmail, json } from '../../fixture-response';
export async function POST(request: Request) {
  if (!hasValidFixtureCsrf(request))
    return json({ error: 'Fixture CSRF validation failed' }, 403);
  const body = await request.json().catch(() => null);
  const parsed = reuseCheckoutOrderSchema.safeParse(body);
  if (!parsed.success)
    return json({ error: 'Invalid fixture order reuse request' }, 400);
  if (parsed.data.order_id !== order.id)
    return json({ error: 'Order not found' }, 404);
  const expectedCustomerEmail =
    fixtureCustomerEmail(request) ?? order.customer_email;
  if (
    parsed.data.merchant_id !== merchant.id ||
    parsed.data.tracking_token !== order.tracking_token ||
    parsed.data.customer_email !== expectedCustomerEmail
  )
    return json({ error: 'Unauthorized' }, 403);
  return json({ order: { ...order, customer_email: expectedCustomerEmail } });
}
