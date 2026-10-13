import { NextRequest } from 'next/server';
import { POST as postShippingQuotes } from '@/app/api/shipping/quotes/route';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Params) {
  const { id } = await context.params;
  const headers = new Headers(request.headers);
  headers.set('x-baci-admin-order-mode', '1');
  headers.set('x-baci-admin-order-id', id);
  // Clone as a real NextRequest so cookie/CSRF paths keep cookies + nextUrl.
  return await postShippingQuotes(new NextRequest(request, { headers }));
}
