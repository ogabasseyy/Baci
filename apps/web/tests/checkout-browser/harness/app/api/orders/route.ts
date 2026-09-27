import { orderCreateSchema } from '@/schemas/orders';
import { json, orderResponse } from '../fixture-response';
export function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey)
    return json({ error: 'Missing fixture idempotency key' }, 400);
  return request
    .json()
    .then((body: unknown) => {
      const parsed = orderCreateSchema.safeParse(body);
      if (!parsed.success)
        return json(
          {
            error: 'Invalid fixture order request',
            issues: parsed.error.issues.map((issue) => issue.path.join('.')),
          },
          400
        );
      const response = json(
        orderResponse({
          customer_name: parsed.data.customer_name,
          customer_email: parsed.data.customer_email,
          customer_phone: parsed.data.customer_phone,
        })
      );
      response.cookies.set(
        'checkout-qa-customer-email',
        parsed.data.customer_email,
        { path: '/', sameSite: 'lax' }
      );
      return response;
    })
    .catch(() => json({ error: 'Invalid fixture order request' }, 400));
}
