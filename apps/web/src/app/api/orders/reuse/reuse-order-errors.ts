export function mapReuseOrderError(
  error: { message?: string; code?: string } | null | undefined
) {
  const message = error?.message || 'order_not_found';

  if (message === 'order_not_found') {
    return { status: 404, error: 'Order not found' };
  }

  if (
    message === 'unauthorized' ||
    message === 'email_mismatch' ||
    message === 'merchant_mismatch'
  ) {
    return { status: 403, error: 'Unauthorized' };
  }

  if (message === 'serialized_inventory_unavailable') {
    return {
      status: 409,
      error: 'Some items in your order are out of stock',
      code: 'serialized_inventory_unavailable',
    };
  }

  if (message === 'oxygen_payment_in_progress') {
    return {
      status: 409,
      code: 'oxygen_payment_in_progress',
      error:
        'Your Oxygen payment is in progress. Return to your existing application or contact support before paying again.',
    };
  }

  if (message === 'oxygen_previous_payment_unresolved') {
    return {
      status: 409,
      code: 'oxygen_previous_payment_unresolved',
      error:
        'Your previous payment may still be active. Please complete it or contact support before starting another payment.',
    };
  }

  if (message === 'order_already_paid' || message === 'order_not_reusable') {
    return { status: 409, error: 'Order is no longer reusable' };
  }

  return { status: 409, error: 'Order is no longer reusable' };
}

export function isExpectedReuseOrderError(
  error: { message?: string; code?: string } | null | undefined
) {
  return (
    !error ||
    [
      'order_not_found',
      'unauthorized',
      'email_mismatch',
      'merchant_mismatch',
      'order_already_paid',
      'order_not_reusable',
      'oxygen_payment_in_progress',
      'oxygen_previous_payment_unresolved',
      'serialized_inventory_unavailable',
    ].includes(error.message || '')
  );
}

export function getSafeReuseOrderErrorMessage(
  error: { message?: string; code?: string } | null | undefined
) {
  return (error?.message || 'unknown')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 300);
}
