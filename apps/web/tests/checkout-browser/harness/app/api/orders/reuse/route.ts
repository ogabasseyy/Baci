import { reuseCheckoutOrderSchema } from '@/schemas/orders';
import { order } from '../../../../../setup';
import { json } from '../../fixture-response';
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!reuseCheckoutOrderSchema.safeParse(body).success)
    return json({ error: 'Invalid fixture order reuse request' }, 400);
  return json({ order });
}
