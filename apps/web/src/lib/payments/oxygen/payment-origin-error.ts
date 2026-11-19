export const oxygenPaymentOriginCode = 'OXYGEN_PAYMENT_ORIGIN_UNVERIFIED';
export const oxygenPaymentOriginMessage =
  'We need to check your existing payment before continuing. Please contact support with your order number.';

export function isOxygenPaymentOriginError(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === '23514' &&
    error.message === 'oxygen_payment_origin_unverified'
  );
}

export class OxygenPaymentOriginUnverifiedError extends Error {
  constructor() {
    super(oxygenPaymentOriginMessage);
    this.name = 'OxygenPaymentOriginUnverifiedError';
  }
}
