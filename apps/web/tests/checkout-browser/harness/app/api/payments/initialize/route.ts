import { cookies } from 'next/headers';
import { merchant } from '../../../../../fixtures';
import { order } from '../../../../../setup';
import { fixtureCustomerEmail, json, scenario } from '../../fixture-response';
import { paymentInitFixtureSchema } from './payment-init-fixture-schema';
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = paymentInitFixtureSchema.safeParse(body);
  if (!parsed.success)
    return json({ error: 'Invalid fixture payment request' }, 400);
  if (
    parsed.data.order_id !== order.id ||
    parsed.data.customer_email !==
      (fixtureCustomerEmail(request) ?? order.customer_email)
  )
    return json({ error: 'Order not found' }, 404);
  if (parsed.data.merchant_id !== merchant.id)
    return json({ error: 'Unauthorized' }, 403);
  const selectedScenario =
    (await cookies()).get('checkout-qa-scenario')?.value ?? scenario(request);
  if (selectedScenario === 'provider-error')
    return json({ error: 'Fixture provider error. No payment was sent.' }, 503);
  return json({
    success: true,
    reference: `fixture-${String(parsed.data.gateway ?? 'payment')}-reference`,
    authorization_url: '/payment-handoff',
  });
}
