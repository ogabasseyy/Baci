import { order } from '../../../../../../setup';
import { fixtureCustomerEmail, json } from '../../../fixture-response';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  const trackingToken = query.get('token') ?? query.get('tracking_token');
  if (
    id !== order.id ||
    trackingToken !== order.tracking_token ||
    query.get('merchant_slug') !== 'ogabassey'
  )
    return json({ error: 'Fixture order lookup did not match' }, 404);
  return json({
    ...order,
    customer_email: fixtureCustomerEmail(request) ?? order.customer_email,
  });
}
