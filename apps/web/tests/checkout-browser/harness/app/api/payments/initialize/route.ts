import { cookies } from 'next/headers';
import { json, scenario } from '../../fixture-response';
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const selectedScenario =
    (await cookies()).get('checkout-qa-scenario')?.value ?? scenario(request);
  if (selectedScenario === 'provider-error')
    return json({ error: 'Fixture provider error. No payment was sent.' }, 503);
  return json({
    success: true,
    reference: `fixture-${String(body.gateway ?? 'payment')}-reference`,
    authorization_url: '/payment-handoff',
  });
}
