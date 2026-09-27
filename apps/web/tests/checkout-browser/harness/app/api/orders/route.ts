import { json, orderResponse } from '../fixture-response';
export function POST(request: Request) {
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey)
    return json({ error: 'Missing fixture idempotency key' }, 400);
  return json(orderResponse());
}
