import {
  OXYGEN_REPAYMENT_HISTORY_LIMIT,
  oxygenOrderPlanSchema,
  oxygenRepaymentReceiptSchema,
} from '@baci/shared/schemas/oxygen-order-plan';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  type OxygenRuntimeRpc,
  type OxygenRuntimeSnapshot,
  readOxygenSnapshot,
} from '@/lib/payments/oxygen/runtime-service';

const headers = { 'Cache-Control': 'no-store' };

function projectSchedule(
  saved: NonNullable<OxygenRuntimeSnapshot['state']['schedule']>,
  months: number
) {
  const counts = new Map<number, number>();
  for (const { period } of saved) {
    counts.set(period, (counts.get(period) ?? 0) + 1);
  }
  return saved
    .flatMap((row) => {
      if (counts.get(row.period) !== 1 || row.period > months) return [];
      const result =
        oxygenOrderPlanSchema.shape.schedule.element.safeParse(row);
      return result.success ? [result.data] : [];
    })
    .sort((first, second) => first.period - second.period);
}

async function readRepaymentReceipts(client: OxygenRuntimeRpc, id: string) {
  try {
    const { data, error } = await client.rpc(
      'oxygen_order_repayment_receipts',
      {
        p_order_id: id,
      }
    );
    if (error || !Array.isArray(data)) return undefined;
    const receipts: z.infer<typeof oxygenRepaymentReceiptSchema>[] = [];
    for (const item of data) {
      const receipt = oxygenRepaymentReceiptSchema.safeParse(item);
      if (receipt.success) receipts.push(receipt.data);
      if (receipts.length === OXYGEN_REPAYMENT_HISTORY_LIMIT) break;
    }
    return receipts;
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
    if (!booking) return NextResponse.json({ plan: null }, { headers });
    // Bound the customer projection before reading history or sorting rows.
    const months = oxygenOrderPlanSchema.shape.months.parse(
      booking.loan_tenure
    );
    const activationConfirmed =
      snapshot.stage === 'activated' && booking.status === 'ACTIVATED';
    const repaymentReceipts = activationConfirmed
      ? await readRepaymentReceipts(auth.supabase, id.data)
      : undefined;
    const savedSchedule = schedule ?? [];
    const projectedSchedule = projectSchedule(savedSchedule, months);
    const plan = oxygenOrderPlanSchema.parse({
      upfront: booking.total_upfront_payment ?? null,
      upfrontConfirmed: paymentComplete === true,
      activationConfirmed,
      repaymentReceipts,
      months,
      schedule: projectedSchedule,
      scheduleIncomplete:
        savedSchedule.length > 0 &&
        (projectedSchedule.length !== months ||
          projectedSchedule.length !== savedSchedule.length)
          ? true
          : undefined,
    });
    return NextResponse.json({ plan }, { headers });
  } catch {
    return NextResponse.json(
      { error: 'Plan unavailable' },
      { status: 503, headers }
    );
  }
}
