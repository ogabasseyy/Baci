import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensureActionRateLimit } from '@/lib/ensure-action-rate-limit';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { readOxygenSnapshot } from '@/lib/payments/oxygen/runtime-service';
import {
  oxygenBankProviderListSchema,
  oxygenBankRequestSchema,
  oxygenProviderAccountNameSchema,
} from '@/schemas/oxygen-bank-details';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};
const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers });
/** Authenticated, ownership-scoped bank lookup only; never books or moves money. */
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return csrf.response ?? fail(403, 'Invalid request');
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return fail(401, 'Unauthorized');
  if (
    !(await ensureActionRateLimit('oxygen-bank-details', {
      requests: 10,
      windowMs: 60_000,
    }))
  )
    return fail(429, 'Too many requests');
  const body = await readBoundedJsonBody(request, 4096);
  const parsed = oxygenBankRequestSchema.safeParse(body.ok ? body.body : null);
  if (!parsed.success) return fail(400, 'Invalid bank details');
  let snapshot: Awaited<ReturnType<typeof readOxygenSnapshot>>;
  try {
    snapshot = await readOxygenSnapshot(auth.supabase, parsed.data.workflowId);
  } catch {
    return fail(404, 'Application unavailable');
  }
  if (snapshot.stage !== 'application_required')
    return fail(409, 'Bank setup unavailable at this stage');
  const connection = connectOxygenRuntime();
  if (!connection) return fail(503, 'Bank lookup unavailable');
  try {
    if (parsed.data.action === 'banks') {
      const result = oxygenBankProviderListSchema.parse(
        await connection.provider.call('banks', {})
      );
      return NextResponse.json(
        {
          banks: result.Result.map((bank) => ({
            name: bank.Name,
            code: bank.SortCode,
          })),
        },
        { headers }
      );
    }
    const phone = snapshot.checkoutPhone
      .replace(/\D/g, '')
      .replace(/^0/, '234');
    if (!/^234\d{10}$/.test(phone)) return fail(409, 'Checkout phone required');
    const result = oxygenProviderAccountNameSchema.parse(
      await connection.provider.call('name_enquiry', {
        bank_code: parsed.data.bank_code,
        account_number: parsed.data.account_number,
        phone_number: phone,
        type: 'EXTERNAL',
      })
    );
    return NextResponse.json({ accountName: result.accountName }, { headers });
  } catch {
    return fail(
      503,
      'Unable to verify bank details. Check the account and try again.'
    );
  }
}
