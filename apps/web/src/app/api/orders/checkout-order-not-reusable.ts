import { NextResponse } from 'next/server';

export function checkoutOrderNotReusable() {
  return NextResponse.json(
    {
      code: 'CHECKOUT_ORDER_NOT_REUSABLE',
      error:
        'This checkout order can no longer be reused. Refresh checkout and start a new order.',
    },
    { status: 409 }
  );
}
