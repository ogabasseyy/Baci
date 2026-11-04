import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkoutResidentialSuggestion } from '@/lib/payments/oxygen/checkout-residential-suggestion';
import { readOxygenResidentialDraft } from '@/lib/payments/oxygen/draft-store';

const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};
/** Read-only suggestion from the caller-owned order; never a verified home address. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  const id = z.uuid().safeParse(request.nextUrl.searchParams.get('workflowId'));
  if (!id.success)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400, headers }
    );
  const workflow = await auth.supabase
    .from('oxygen_workflows')
    .select('order_id, merchant_id, customer_id')
    .eq('id', id.data)
    .maybeSingle();
  if (workflow.error || !workflow.data)
    return NextResponse.json(
      { error: 'Unavailable' },
      { status: 404, headers }
    );
  const order = await auth.supabase
    .from('orders')
    .select('shipping_address, delivery_method')
    .eq('id', workflow.data.order_id)
    .eq('merchant_id', workflow.data.merchant_id)
    .eq('customer_id', workflow.data.customer_id)
    .maybeSingle();
  if (order.error || !order.data)
    return NextResponse.json(
      { error: 'Unavailable' },
      { status: 404, headers }
    );
  let saved: Record<string, string> = {};
  try {
    saved = await readOxygenResidentialDraft(
      auth.supabase,
      auth.user.id,
      id.data
    );
  } catch {
    /* A missing/expired encrypted draft never blocks manual address entry. */
  }
  const fromDraft = Boolean(saved.street);
  return NextResponse.json(
    {
      address: fromDraft
        ? saved
        : checkoutResidentialSuggestion(
            order.data.delivery_method,
            order.data.shipping_address
          ),
      source: fromDraft ? 'saved' : 'checkout',
    },
    { headers }
  );
}
