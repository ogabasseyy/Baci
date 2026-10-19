import { NextResponse } from 'next/server';

/**
 * Map known wallet-charge trigger rejections to stable 409 responses so
 * address/quote conflicts are not reported as generic 500s.
 */
export function mapOrderPatchUpdateError(updateError: {
  code?: string;
  message?: string;
}): NextResponse | null {
  const message = updateError.message ?? '';

  if (message.includes('active_shipping_charge_address_edit_blocked')) {
    return NextResponse.json(
      {
        code: 'active_shipping_charge_address_edit_blocked',
        error:
          'Shipping address cannot change while a wallet shipping charge is active.',
      },
      { status: 409 }
    );
  }

  if (message.includes('active_shipping_charge_quote_replacement_blocked')) {
    return NextResponse.json(
      {
        code: 'active_shipping_charge_quote_replacement_blocked',
        error:
          'Shipping quote cannot change while a wallet shipping charge is active.',
      },
      { status: 409 }
    );
  }

  return null;
}
