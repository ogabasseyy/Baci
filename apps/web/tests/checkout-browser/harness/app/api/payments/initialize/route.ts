import { cookies } from 'next/headers';
import { z } from 'zod';
import { json, scenario } from '../../fixture-response';

const paymentInitFixtureSchema = z.object({
  merchant_id: z.uuid(),
  order_id: z.uuid(),
  currency: z.string().optional(),
  customer_email: z.email(),
  customer_name: z.string().min(1),
  customer_phone: z.string().min(1),
  gateway: z
    .enum([
      'paystack',
      'korapay',
      'juicyway',
      'credit_direct',
      'credpal',
      'klump',
    ])
    .optional(),
  billing_address: z
    .object({
      line1: z.string().min(1).optional(),
      line2: z.string().optional(),
      city: z.string().min(1).optional(),
      state: z.string().optional(),
      country: z.string().length(2),
      zip_code: z.string().min(1).optional(),
    })
    .optional(),
});
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
