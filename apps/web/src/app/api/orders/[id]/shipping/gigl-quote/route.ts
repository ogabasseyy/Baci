import { NextRequest, NextResponse } from 'next/server';
import { POST as postShippingQuotes } from '@/app/api/shipping/quotes/route';
import { authenticateApiRequest } from '@/lib/api-auth';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Params) {
  const { id } = await context.params;
  try {
    // Authenticate before buffering the body so an unauthenticated caller
    // cannot make the route hold an upload in memory. The quotes handler
    // authenticates again and applies the order/merchant checks.
    const auth = await authenticateApiRequest(request);
    if (!auth.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const headers = new Headers(request.headers);
    headers.set('x-baci-admin-order-mode', '1');
    headers.set('x-baci-admin-order-id', id);
    // Forward the raw bytes so the body is passed through unchanged.
    const body = await request.arrayBuffer();
    // Build a fresh request from the URL instead of passing the incoming
    // request object to `new NextRequest(request, …)`: that copy throws
    // "Cannot read private member #state" on the production runtime.
    // Delegating through the quotes route keeps this route's import graph
    // (and credential reach) identical to the governed shipping-quotes path.
    const delegated = new NextRequest(request.url, {
      body: body.byteLength > 0 ? body : undefined,
      headers,
      method: request.method,
    });
    return await postShippingQuotes(delegated);
  } catch (error) {
    // Log only the error type: messages and bodies can carry provider data.
    console.error('Error getting admin order GIGL quote', {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: 'Failed to get GIG quote' },
      { status: 500 }
    );
  }
}
