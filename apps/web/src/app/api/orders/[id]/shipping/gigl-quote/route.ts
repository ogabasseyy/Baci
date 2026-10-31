import { type NextRequest, NextResponse } from 'next/server';
import { postAdminOrderGiglQuote } from '@/app/api/shipping/quotes/admin-order-gigl-quote';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Params) {
  const { id } = await context.params;
  try {
    // Pass the original request through: re-wrapping it with
    // `new NextRequest(request, …)` crashes in production with
    // "Cannot read private member #state". The path id is the order.
    return await postAdminOrderGiglQuote(request, { admin_order_id: id });
  } catch (error) {
    console.error('Error getting admin order GIGL quote:', error);
    return NextResponse.json(
      { error: 'Failed to get GIG quote' },
      { status: 500 }
    );
  }
}
