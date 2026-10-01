import { NextResponse } from 'next/server';

export function getDvaReservationProofFailureResponse() {
  return NextResponse.json(
    {
      code: 'PAYMENT_ACCOUNT_PERSIST_FAILED',
      error: 'Failed to save automatic confirmation account',
    },
    { status: 500 }
  );
}

export function getDvaReservationFailureResponse(
  reservation: string | null,
  insertError: { message?: string } | null
) {
  if (
    reservation === 'conflict' ||
    reservation === 'wallet_conflict' ||
    insertError?.message?.includes('PAYSTACK_DVA_ALIAS_CONFLICT')
  ) {
    return NextResponse.json(
      {
        code: 'PAYSTACK_DVA_IN_USE',
        error:
          'This automatic confirmation account is in use by another payment flow',
      },
      { status: 409 }
    );
  }

  if (reservation === 'ineligible') {
    return NextResponse.json(
      {
        code: 'ORDER_NOT_ELIGIBLE_FOR_DVA',
        error: 'Order is no longer eligible for automatic confirmation',
      },
      { status: 409 }
    );
  }

  if (reservation === 'customer_changed') {
    return NextResponse.json(
      {
        code: 'ORDER_CUSTOMER_CHANGED',
        error:
          'Customer email changed while creating automatic confirmation. Please try again.',
      },
      { status: 409 }
    );
  }

  return null;
}
