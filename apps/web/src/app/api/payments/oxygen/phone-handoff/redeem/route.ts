import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { redeemDurableOxygenHandoff } from '@/lib/payments/oxygen/durable-phone-handoff';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { checkOxygenPhoneRedemptionRateLimit } from '@/lib/rate-limit';
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
  if (!(await checkOxygenPhoneRedemptionRateLimit(request)).allowed)
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
    if (raw.length > 32768) throw new Error('Invalid');
    const input = oxygenPhoneRedemptionSchema.safeParse(JSON.parse(raw));
    if (!input.success)
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: 400, headers }
      );
    const result = await redeemDurableOxygenHandoff(
      await connection.worker(),
      input.data.token,
      config,
      input.data.selfieOrigins
    );
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          'We couldn’t open this link. Return to your other device and generate a new QR code.',
      },
      { status: 503, headers }
    );
  }
}
