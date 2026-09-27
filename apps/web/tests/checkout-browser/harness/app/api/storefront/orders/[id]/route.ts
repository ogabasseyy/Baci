import { order } from '../../../../../../setup';
import { json } from '../../../fixture-response';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const query = new URL(request.url).searchParams;
  if (
    id !== order.id ||
    query.get('tracking_token') !== order.tracking_token ||
    query.get('merchant_slug') !== 'ogabassey'
  )
    return json({ error: 'Fixture order lookup did not match' }, 404);
  return json(order);
}
