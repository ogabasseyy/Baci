import { oxygenRepaymentReceiptsSchema } from '@baci/shared/schemas/oxygen-order-plan';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  type OxygenRuntimeRpc,
  readOxygenSnapshot,
} from '@/lib/payments/oxygen/runtime-service';

const headers = { 'Cache-Control': 'no-store' };

async function readRepaymentReceipts(client: OxygenRuntimeRpc, id: string) {
  try {
    const { data, error } = await client.rpc(
      'oxygen_order_repayment_receipts',
      {
        p_order_id: id,
      }
    );
    if (error) return undefined;
    const result = oxygenRepaymentReceiptsSchema.safeParse(data);
    return result.success ? result.data : undefined;
  } catch {
    // The booked schedule is available even if receipt history cannot be read.
    return undefined;
  }
}

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
    const activationConfirmed =
      snapshot.stage === 'activated' && booking?.status === 'ACTIVATED';
    const repaymentReceipts = activationConfirmed
      ? await readRepaymentReceipts(auth.supabase, id.data)
      : undefined;
    return NextResponse.json(
      {
        plan: booking
          ? {
              upfront: booking.total_upfront_payment ?? null,
              upfrontConfirmed: paymentComplete === true,
              activationConfirmed,
              repaymentReceipts,
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
