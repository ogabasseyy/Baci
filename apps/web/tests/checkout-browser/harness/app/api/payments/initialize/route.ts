import { cookies } from 'next/headers';
import { json, scenario } from '../../fixture-response';
import { paymentInitFixtureSchema } from './payment-init-fixture-schema';
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = paymentInitFixtureSchema.safeParse(body);
  if (!parsed.success)
    return json({ error: 'Invalid fixture payment request' }, 400);
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
