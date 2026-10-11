export function getProfileUpdateError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.includes('customers_merchant_phone_unique')
  ) {
    return 'This phone number is already linked to a customer record. Use another number or contact support to verify ownership.';
  }
  return 'Could not update your profile. Please try again.';
}
