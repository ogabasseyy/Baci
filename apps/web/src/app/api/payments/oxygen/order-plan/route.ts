import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { readOxygenSnapshot } from '@/lib/payments/oxygen/runtime-service';

const headers = { 'Cache-Control': 'no-store' };
// Read saved, customer-owned facts only. Never create/resume a provider action.
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get('orderId'));
  if (!id.success)
    return NextResponse.json(
      { error: 'Invalid order' },
      { status: 400, headers }
    );
  const workflow = await auth.supabase
    .from('oxygen_workflows')
    .select('id')
    .eq('order_id', id.data)
    .maybeSingle();
  if (workflow.error)
    return NextResponse.json(
      { error: 'Plan unavailable' },
      { status: 503, headers }
    );
  if (!workflow.data) return NextResponse.json({ plan: null }, { headers });
  try {
    const snapshot = await readOxygenSnapshot(auth.supabase, workflow.data.id);
    const { booking, schedule, paymentComplete } = snapshot.state;
    return NextResponse.json(
      {
        plan: booking
          ? {
              upfront: booking.total_upfront_payment ?? null,
              upfrontConfirmed: paymentComplete === true,
              activationConfirmed:
                snapshot.stage === 'activated' &&
                booking.status === 'ACTIVATED',
              months: booking.loan_tenure,
              schedule: (schedule ?? []).map(({ period, dueDate, amount }) => ({
                period,
                dueDate,
                amount,
              })),
            }
          : null,
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { error: 'Plan unavailable' },
      { status: 503, headers }
    );
  }
}
