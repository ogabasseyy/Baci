import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { redeemDurableOxygenHandoff } from '@/lib/payments/oxygen/durable-phone-handoff';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { oxygenPhoneRedemptionSchema } from '@/schemas/oxygen-phone-handoff';
export const maxDuration = 30;
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
/** Anonymous phone uses an unguessable single-use capability, never the laptop session. */
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      NextResponse.json({ error: 'Invalid request' }, { status: 403, headers })
    );
  if (
    !(await ensureActionRateLimit('oxygen-phone-redemption', {
      requests: 10,
      windowMs: 60000,
    }))
  )
    return NextResponse.json(
      { error: 'Please wait and try again' },
      { status: 429, headers }
    );
  const connection = connectOxygenRuntime();
  const config = connection?.phoneConfiguration;
  if (!connection || !config)
    return NextResponse.json(
      { error: 'Phone verification unavailable' },
      { status: 503, headers }
    );
  if (request.headers.get('origin') !== config.origin)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 403, headers }
    );
  try {
    const raw = await request.text();
    if (raw.length > 200) throw new Error('Invalid');
    const input = oxygenPhoneRedemptionSchema.safeParse(JSON.parse(raw));
    if (!input.success)
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: 400, headers }
      );
    const result = await redeemDurableOxygenHandoff(
      await connection.worker(),
      input.data.token,
      config
    );
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          'This link is unavailable. Scan a new QR code on your other device.',
      },
      { status: 410, headers }
    );
  }
}
